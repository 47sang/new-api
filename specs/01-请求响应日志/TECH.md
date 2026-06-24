# TECH.md — 请求/响应日志功能技术规格

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    请求/响应日志系统                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   middleware/response_recorder.go                           │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  ResponseRecorderMiddleware                          │   │
│   │  - 包装 gin.ResponseWriter                           │   │
│   │  - 捕获非流式响应体                                   │   │
│   │  - 自动跳过 WS/SSE/二进制响应                         │   │
│   │  - 通过 saveFunc 回调异步保存                         │   │
│   └─────────────────────────────────────────────────────┘   │
│              ▲                                               │
│              │ 通过路由中间件挂载                             │
│              │                                               │
│   router/relay-router.go                                    │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  httpRouter.Use(ResponseRecorderMiddleware(saveFn))  │   │
│   │  playgroundRouter.Use(...)                           │   │
│   │  relaySunoRouter.Use(...)                            │   │
│   │  relayGeminiRouter.Use(...)                          │   │
│   │  relayMjRouter.Use(...)                              │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   model/request_response_log.go                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  RequestResponseLog 模型                              │   │
│   │  SaveRequestResponseLog() → 写入 DB                  │   │
│   │  GetRequestResponseLogByRequestId() → 查询 DB        │   │
│   │  CleanupOldRequestResponseLogs() → 清理过期数据      │   │
│   │  StartRequestResponseLogCleanup() → 定时清理 goroutine│   │
│   └─────────────────────────────────────────────────────┘   │
│              ▲                                               │
│              │ 异步调用，回调解耦                              │
│              │                                               │
│   controller/request_response_log.go                        │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  GET /api/log/:id/request-response (admin)           │   │
│   │  GET /api/log/self/:id/request-response (user)       │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 2. 数据模型

### 2.1 表结构

表名：`request_response_logs`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGINT | 主键, 自增, 索引 | 内部主键 |
| `request_id` | VARCHAR(64) | 唯一索引, 非空 | 关联 `logs.request_id` |
| `request_body` | MEDIUMTEXT | — | 原始请求 JSON（最大 ~16MB） |
| `response_body` | MEDIUMTEXT | — | 原始响应 JSON（最大 ~16MB，超过 2MB 截断） |
| `is_completed` | BOOLEAN | 默认 true | 响应是否完整（流式=false） |
| `response_size` | INT | 默认 0 | 响应体字节大小 |
| `status_code` | INT | 默认 0 | HTTP 状态码 |
| `created_at` | BIGINT | 索引 | Unix 时间戳 |

**索引策略：**
- `idx_req_log_created` 复合索引：`(request_id, created_at)` — 加速按 request_id 查询
- `request_id` 唯一索引：保证同一请求只记录一次

**跨数据库兼容性：**
- `MEDIUMTEXT` 在 SQLite / MySQL 中直接支持，PostgreSQL 映射为 `TEXT`（GORM 自动处理）
- 无需数据库特定的迁移脚本，`AutoMigrate` 即可

### 2.2 与现有系统的关联

```
logs (已有)                      request_response_logs (新建)
┌──────────────────┐             ┌──────────────────────────┐
│ id               │             │ id                       │
│ request_id ──────┼─────┐       │ request_id (UNIQUE) ─────┼── 1:1
│ upstream_request_id           │ request_body             │
│ content          │     │       │ response_body            │
│ ...              │     └─────▶│ is_completed             │
└──────────────────┘             │ response_size            │
                                 │ status_code              │
                                 │ created_at               │
                                 └──────────────────────────┘
```

- 关联键：`logs.request_id` = `request_response_logs.request_id`
- 关系：1:1（每个 request_id 最多一条记录）

## 3. 核心实现

### 3.1 请求体捕获（零成本复用）

请求体在 `controller/relay.go` 第 200 行已被 `common.GetBodyStorage(c)` 捕获：

```go
bodyStorage, bodyErr := common.GetBodyStorage(c)
// bodyStorage 实现了 BodyStorage 接口：
//   Bytes() ([]byte, error)  — 获取原始请求字节
//   Size() int64             — 请求体大小
//   IsDisk() bool            — 是否在磁盘临时文件
```

- 小请求：内存存储（`memoryStorage`）
- 大请求（超过磁盘缓存阈值）：临时文件存储（`diskStorage`）
- 中间件 `BodyStorageCleanup` 在请求结束后自动清理

### 3.2 响应体捕获（responseRecorder 中间件）

**核心思路：** 用自定义 `responseRecorder` 包装 `gin.ResponseWriter`，所有写入操作被拦截并缓存在 `bytes.Buffer` 中。

**响应流分类处理：**

| 响应类型 | Content-Type | 处理方式 |
|---|---|---|
| JSON API 响应 | `application/json` | 完整捕获 |
| SSE 流式 | `text/event-stream` | 跳过（不记录） |
| 图片 | `image/*` | 跳过 |
| 音频 | `audio/*` | 跳过 |
| 视频 | `video/*` | 跳过 |
| 二进制 | `application/octet-stream` | 跳过 |

**WebSocket 检测：** 通过 `Upgrade: websocket` 请求头判断，跳过后直接透传。

**写入时机：** `c.Next()` 返回后（即 handler 执行完毕），检查 `headerWritten && !isStreamingResponse()`，通过 `go func()` 异步写入数据库。

### 3.3 响应录制器接口实现

`responseRecorder` 实现了完整的 `gin.ResponseWriter` 接口：

```go
// gin.ResponseWriter = http.ResponseWriter + http.Hijacker + http.Flusher + http.CloseNotifier
//                    + Status() + Size() + WriteString() + Written() + WriteHeaderNow() + Pusher()
```

关键设计点：
- `WriteHeader` 中缓存 Content-Type（在透传给底层 writer 之前）
- `headerWritten` 标志防止重复写入状态码
- 所有公共方法加 `mu` 锁，保证 `c.Next()` 前后 goroutine 安全

### 3.4 路由集成

| 路由组 | 中间件 | 排除场景 |
|---|---|---|
| `httpRouter` (`/v1/...`) | `ResponseRecorderMiddleware` | `/v1/realtime`（WS）单独路由组 |
| `playgroundRouter` (`/pg/...`) | `ResponseRecorderMiddleware` | — |
| `relaySunoRouter` (`/suno/...`) | `ResponseRecorderMiddleware` | — |
| `relayGeminiRouter` (`/v1beta/...`) | `ResponseRecorderMiddleware` | — |
| `relayMjRouter` (`/mj/...`) | `ResponseRecorderMiddleware` | 图片二进制自动跳过 |

### 3.5 API 路由

| 方法 | 路径 | 中间件 | 说明 |
|---|---|---|---|
| `GET` | `/api/log/:id/request-response` | `AdminAuth()` | 管理员查看任意日志的请求/响应 |
| `GET` | `/api/log/self/:id/request-response` | `UserAuth()` | 普通用户查看自己的请求/响应 |

查询流程：
1. 从 `logs` 表按 `id` 获取日志记录，提取 `request_id`
2. 权限校验：非管理员需 `log.UserId == currentUserId`
3. 从 `request_response_logs` 表按 `request_id` 查询完整数据
4. 返回 `RequestResponseLog` JSON

## 4. 配置项

| 配置 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| 功能开关 | `REQUEST_RESPONSE_LOG_ENABLED` | `false` | 是否开启请求/响应日志记录 |
| 保留天数 | `REQUEST_RESPONSE_LOG_RETENTION_DAYS` | `7` | 日志保留天数，`0` = 永久 |
| Option 表键 | `RequestResponseLogEnabled` | `false` | 运行时动态开关（与 env 联动） |

## 5. 定时清理

- **触发时机**：服务启动时 + 每 24 小时
- **实现**：`time.NewTicker(24 * time.Hour)` + goroutine
- **清理逻辑**：`DELETE FROM request_response_logs WHERE created_at < cutoff`
- **保留期 = 0 时**：不启动清理 goroutine，数据永久保留
- **日志输出**：删除数量 > 0 时输出 `SysLog`，错误时输出 `SysError`

## 6. 性能与容量估算

| 维度 | 评估 |
|---|---|
| 请求体存储 | 复用已有 BodyStorage，无额外内存分配 |
| 响应体缓存 | 仅非流式 JSON 响应，通常 < 100KB；超 2MB 截断 |
| 写入时机 | `c.Next()` 后的 goroutine，不阻塞主链路 |
| 开关关闭时开销 | 零（中间件开头直接 `c.Next()` 返回） |
| 单条记录最大体积 | 请求体 + 响应体 ≈ 4MB（各 2MB 上限） |
| 7 天数据估算 | 按 1000 次/天、平均 20KB/条 ≈ 140MB |

## 7. 数据库迁移

`migrateLOGDB()` 中增加 `AutoMigrate(&RequestResponseLog{})`：

```go
func migrateLOGDB() error {
    // ... 已有 Log 迁移
    if err = LOG_DB.AutoMigrate(&RequestResponseLog{}); err != nil {
        return err
    }
    // 启动时清理
    if common.RequestResponseLogEnabled && common.RequestResponseLogRetentionDays > 0 {
        // CleanupOldRequestResponseLogs(...)
    }
    return nil
}
```

GORM 的 `AutoMigrate` 会自动创建 `request_response_logs` 表（如果不存在），并对已有表添加缺失的列/索引。

## 8. 依赖关系

```
middleware/response_recorder.go
  ├── common (RequestResponseLogEnabled, GetBodyStorage, SysLog)
  ├── gin (gin.ResponseWriter, gin.Context)
  └── model.SaveRequestResponseLog (通过回调函数传入，避免循环导入)

model/request_response_log.go
  ├── common (RequestResponseLogEnabled, GetTimestamp, SysLog, SysError)
  ├── gorm (gorm.DB, ErrRecordNotFound)
  └── time (Now, AddDate)

controller/request_response_log.go
  ├── common (ApiError, ApiSuccess, RoleAdminUser)
  ├── model (GetLogById, GetRequestResponseLogByRequestId)
  ├── types (NewErrorWithStatusCode, ErrorCode*)
  └── gin (gin.Context)

router/api-router.go
  └── middleware (AdminAuth, UserAuth)

router/relay-router.go
  └── middleware (ResponseRecorderMiddleware)
  └── model (SaveRequestResponseLog)  // 新增导入
```

## 9. 风险与注意事项

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| 存储膨胀 | 高频场景下数据增长快 | 默认关闭 + 7天自动清理 + 2MB 截断 |
| 内存占用 | 响应缓存 buffer 占用内存 | 仅缓存非流式 JSON 响应；二进制自动跳过 |
| 循环导入 | middleware → model 可能产生循环 | 通过 `saveFunc` 回调注入，中间件不直接 import model |
| gin 接口兼容 | `gin.ResponseWriter` 包含多个子接口 | 完整实现 `Hijacker/CloseNotifier/Flusher/Pusher` 等 |
| 跨数据库兼容 | MEDIUMTEXT 在 PG 中的行为 | GORM 自动映射 MEDIUMTEXT → TEXT |
