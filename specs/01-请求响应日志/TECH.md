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
│   │  - 包装 gin.ResponseWriter（tee：转发 + 缓冲）        │   │
│   │  - 非流式与 SSE 流式响应体均完整捕获                   │   │
│   │  - WS 升级请求跳过；二进制响应不落库                  │   │
│   │  - c.Next() 后异步保存（分片只在内存累积）            │   │
│   └─────────────────────────────────────────────────────┘   │
│              ▼ 异步 goroutine 内                             │
│   middleware/response_stream_merge.go                       │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  mergeStreamResponseBody                             │   │
│   │  - SSE 分片合并为单个最终响应对象（4 类主流格式）      │   │
│   │  - 未识别格式原样回退，数据不丢失                     │   │
│   └─────────────────────────────────────────────────────┘   │
│              ▲                                               │
│              │ 通过路由中间件挂载                             │
│              │                                               │
│   router/relay-router.go                                    │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  httpRouter.Use(ResponseRecorderMiddleware(saveFn))  │   │
│   │  playgroundRouter.Use(...)                           │   │
│   │  relayGeminiRouter.Use(...)                          │   │
│   │  relayMjRouter/MjModeRouter.Use(...)（共用注册函数）  │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   model/request_response_log.go                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  RequestResponseLog 模型                              │   │
│   │  SaveRequestResponseLog() → UPSERT 写入 DB           │   │
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
| `request_body` | LONGTEXT/TEXT | — | 原始请求体（multipart 存占位符） |
| `response_body` | LONGTEXT/TEXT | — | 响应体（非截断；流式=分片合并后的单个最终响应对象 JSON，未识别格式=原始 SSE 报文） |
| `is_stream` | BOOLEAN | 默认 false | 是否流式（SSE）响应 |
| `is_completed` | BOOLEAN | 默认 true | 响应是否完整捕获（中断/二进制=false） |
| `response_size` | INT | 默认 0 | 响应体字节大小 |
| `status_code` | INT | 默认 0 | HTTP 状态码 |
| `created_at` | BIGINT | 索引 | Unix 时间戳 |

**索引策略：**
- `created_at` 单列索引：加速按日期滚动的清理 DELETE（request_id 查询已由唯一索引覆盖，无需复合索引）
- `request_id` 唯一索引：保证同一请求只保留一行（UPSERT 依据）

**跨数据库兼容性：**
- 大文本列**不加 GORM type 标签**：GORM 对无 size 的 string 字段在 MySQL 上映射为 `LONGTEXT`，PostgreSQL / SQLite 上映射为 `TEXT`，三者均无 64KB 限制且无需截断
- 注意：不能使用 `type:MEDIUMTEXT` 标签——PostgreSQL 不支持该类型名，会导致迁移失败

### 2.2 与现有系统的关联

```
logs (已有)                      request_response_logs (新建)
┌──────────────────┐             ┌──────────────────────────┐
│ id               │             │ id                       │
│ request_id ──────┼─────┐       │ request_id (UNIQUE) ─────┼── 1:1
│ upstream_request_id           │ request_body             │
│ content          │     │       │ response_body            │
│ ...              │     └─────▶│ is_stream                │
└──────────────────┘             │ is_completed             │
                                 │ response_size            │
                                 │ status_code              │
                                 │ created_at               │
                                 └──────────────────────────┘
```

- 关联键：`logs.request_id` = `request_response_logs.request_id`
- 关系：1:1（每个 request_id 最多一条记录）

## 3. 核心实现

### 3.1 请求体捕获（零成本复用）

请求体在 relay 链路中已被 `common.GetBodyStorage(c)` 捕获：

```go
storage, err := common.GetBodyStorage(c)
// BodyStorage 接口：
//   Bytes() ([]byte, error)  — 获取原始请求字节
//   IsDisk() bool            — 是否在磁盘临时文件
```

- 小请求：内存存储（`memoryStorage`）
- 大请求（超过磁盘缓存阈值）：临时文件存储（`diskStorage`）
- 中间件 `BodyStorageCleanup` 在请求结束后清理存储

**⚠️ 读取时机**：请求体必须在中间件 `c.Next()` 返回后、**同步**读取（转成 string 再传给异步 goroutine）。`BodyStorageCleanup` 是更外层的中间件，其清理发生在 recorder 中间件之后，同步读取无竞态；若在 goroutine 里再读则可能撞上清理。

**multipart 保护**：`Content-Type` 以 `multipart/form-data` 开头的请求（音频转写、图片编辑等文件上传），请求体保存占位符 `[multipart request body omitted]`，避免二进制内容膨胀文本列。

### 3.2 响应体捕获（responseRecorder 中间件）

**核心思路**：自定义 `responseRecorder` 内嵌 `gin.ResponseWriter`（接口嵌入，非再包一层 struct），`Write`/`WriteString` 变成 tee——**同时写入底层 writer（转发给客户端）和内存 `bytes.Buffer`**，其余方法（Flush/Hijack/CloseNotify/Status/Size 等）由内嵌接口自动透传。

> 原实现的致命缺陷：`Write` 只写 buffer、从不转发底层 writer，开启功能后所有响应体都到不了客户端。重实现必须 tee。

**响应流分类处理：**

| 响应类型 | Content-Type | 处理方式 |
|---|---|---|
| JSON API 响应 | `application/json` | 完整捕获，`is_stream=false` |
| SSE 流式 | `text/event-stream` | 完整捕获原始 SSE 报文，`is_stream=true`；落库前合并为单个最终响应对象（见 3.3） |
| 图片 / 音频 / 视频 | `image/*` `audio/*` `video/*` `application/octet-stream` | 响应体不落库（置空），`is_completed=false` |

**WebSocket 检测**：通过 `Upgrade: websocket` 请求头判断，跳过包装直接透传（`/v1/realtime` 本就在独立路由组，此为兜底）。

**写入时机**：通过 `defer` 在中间件返回时落库（正常结束与 handler 链 panic 均会执行，保证出错请求也有记录；panic 继续向外传播由 `CustomRecovery` 捕获）：

- 非流式：一次性 INSERT
- 流式：**分片全程只在内存 buffer 累积，结束才写一次 DB**——不存在分片级 UPDATE，无 O(n²) 写放大；`request_id` 唯一索引 + UPSERT 保证每请求一行
- `is_completed` 判定：`c.Request.Context().Err() == nil`（流正常结束）为 true，客户端中断为 false
- **背压保护**：并发落库 goroutine 由容量为 8 的信号量限制，队列满时丢弃并输出 SysLog，防止日志库变慢（SQLite 锁、MySQL 慢查询）时内存无界增长
- **编码净化**：落库前 `strings.ToValidUTF8` 替换非法字节为 U+FFFD，避免 MySQL（utf8mb4 严格模式）/PostgreSQL 拒绝写入导致三库行为不一致

### 3.3 流式响应合并（response_stream_merge.go）

原始 SSE 报文每个分片都携带完整的 JSON 结构体（`id`/`model`/`object` 等），逐条存储冗余极大，尤其多轮对话场景。因此在落库前的异步 goroutine 中调用 `mergeStreamResponseBody(raw)`，将整条流**合并为单个最终响应对象**：

```
原始 SSE 报文 ──▶ parseSSEDataPayloads() 提取 data 载荷
                       │（忽略 event:/注释行、跳过 [DONE]、多行 data 以 \n 连接、
                       │  单行上限 32MB，覆盖 base64 大载荷；scanner 出错输出 SysLog 告警）
                       ▼
              逐载荷探测格式（首个含 choices/candidates 键或
              type 为 Claude 事件/response.* 的分片决定格式）
   ┌──────────────┬──────────────┬──────────────┬─────────────────┐
   ▼              ▼              ▼              ▼
choices[].delta  type=message_start…  candidates  type=response.*
OpenAI Chat      Claude Messages      Gemini      OpenAI Responses
合并为           合并为               合并为       提取终态事件中的
chat.completion  message 对象         生成式响应    完整 response 对象
   └──────────────┴──────────────┴──────────────┴─────────────────┘
                       ▼
          未识别 / 解析失败 / 无有效内容 → 原样返回原始 SSE 报文
```

**合并规则要点：**

| 格式 | 识别特征 | 合并行为 |
|---|---|---|
| OpenAI Chat | 顶层存在 `choices` 键 | `content`/`reasoning_content`/`reasoning`/`refusal`/`tool_calls[].function.arguments` 按序拼接；`tool_calls` 按 index 归并（缺 index 时按 id 判定新调用，id/type/name 取首个非空）；`delta.audio` 的 `data`/`transcript` 拼接、`id`/`expires_at` 取首个；`finish_reason`/`usage` 取最后一个非空值；`object` 规范化为 `chat.completion`；顶部元字段（`id`/`created`/`model`/`system_fingerprint`/`service_tier`）取首个非空分片；**delta/choice 上未建模的业务字段**（`annotations`、`logprobs` 等扩展）按「字符串拼接、数组拼接、其余取末值」保留在合并结果中 |
| Claude | 事件 `type` ∈ message_start/content_block_*/message_delta/message_stop/ping/error | 块按 `index` 归并，`text_delta`/`thinking_delta`/`signature_delta`/`input_json_delta`/`citations_delta` 分别累积；块对象以 `content_block_start` 原始字段为基础（保留未知字段）后叠加累积内容；`input` 的 `partial_json` 在流结束时解析为对象，**解析失败（中断截断）时以 `input_raw` 字符串保留参数原文**；`citations` 与块已有的数组合并；`usage` 以 `message_start` 为基线、`message_delta` 覆盖；`stop_reason`/`stop_sequence` 取 `message_delta` 末值 |
| Gemini | 顶层存在 `candidates` 键 | 候选按 `index` 归并；同类型相邻 part 按出现顺序合并（纯 `text` 与 `text+thought` 分别拼接，非文本 part 原样保留，不改变 part 顺序）；candidate 级未拆分字段（`safetyRatings`、`groundingMetadata`、`citationMetadata` 等）取末值保留；`finishReason`/`usageMetadata` 取末值 |
| OpenAI Responses | 事件 `type` 以 `response.` 开头 | 直接提取 `response.completed` / `response.incomplete` / `response.failed` 终态事件携带的完整 `response` 对象 |

**容错与回退：**

- 单个分片 JSON 非法（如中断导致截断）→ 跳过该分片，合法分片照常合并
- 分片为合法 JSON 但个别字段类型与模型不符（如字符串型 `error`）→ 类型不符的字段被跳过，**其余字段照常参与合并**，整块不再被丢弃
- 未识别格式、全部分片非法、或合并结果无有效内容 → **原样返回原始 SSE 报文**，数据不丢失
- 单个 data 行超过 32MB 上限时 scanner 终止并输出 SysLog 告警（合并结果为已扫描部分，不会无告警静默截断）
- 流中错误事件（Claude `error` 事件、OpenAI `error` 载荷）并入合并结果的 `error` 字段
- JSON 操作全部走 `common.Marshal` / `common.UnmarshalJsonStr` 包装（项目 JSON 规范）
- 合并位于异步落库 goroutine 中执行（CPU 密集操作不占用请求主链路）

**兼容性影响：** 该合并只改变 `response_body` 列的**内容格式**，无表结构变更、无迁移需求。`response_size` 仍记录客户端实际收到的原始流字节数（与合并后内容大小无关联）。前端对合并后 JSON 直接格式化展示，并对旧数据中仍为原始 SSE 报文的记录回退为逐条解析展示（按首行是否以 `data:`/`event:` 开头判定）。

### 3.4 保存与 UPSERT

```go
LOG_DB.Clauses(clauses.OnConflict{
    Columns:   []clause.Column{{Name: "request_id"}},
    DoUpdates: clause.AssignmentColumns([]string{...全部业务列...}),
}).Create(log)
```

- MySQL → `ON DUPLICATE KEY UPDATE`；PostgreSQL / SQLite → `ON CONFLICT (request_id) DO UPDATE`（GORM 自动翻译，三库兼容）
- 正常情况下 `request_id` 全局唯一，冲突不会发生；UPSERT 是幂等性兜底

### 3.5 路由集成

| 路由组 | 中间件 | 排除场景 |
|---|---|---|
| `httpRouter` (`/v1/...`) | `ResponseRecorderMiddleware` | `/v1/realtime`（WS）单独路由组 |
| `playgroundRouter` (`/pg/...`) | `ResponseRecorderMiddleware` | — |
| `relayGeminiRouter` (`/v1beta/...`) | `ResponseRecorderMiddleware` | — |
| `relayMjRouter` + `relayMjModeRouter`（共用 `registerMjRouterGroup`） | `ResponseRecorderMiddleware` | `GET /image/:id`（二进制图片，注册于 Use 之前，天然不带中间件） |

### 3.6 API 路由

| 方法 | 路径 | 中间件 | 说明 |
|---|---|---|---|
| `GET` | `/api/log/:id/request-response` | `AdminAuth()` | 管理员查看任意日志的请求/响应 |
| `GET` | `/api/log/self/:id/request-response` | `UserAuth()` | 普通用户查看自己的请求/响应 |

查询流程：
1. 从 `logs` 表按 `id` 获取日志记录（新增 `model.GetLogById`），提取 `request_id`
2. 权限校验：非管理员需 `log.UserId == currentUserId`
3. 从 `request_response_logs` 表按 `request_id` 查询完整数据
4. 返回 `RequestResponseLog` JSON

## 4. 配置项

| 配置 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| 功能开关 | `REQUEST_RESPONSE_LOG_ENABLED` | `true` | 是否开启请求/响应日志记录（显式设 `false` 可关闭） |
| 保留天数 | `REQUEST_RESPONSE_LOG_RETENTION_DAYS` | `7` | 日志保留天数，`0` = 永久 |
| Option 表键 | `RequestResponseLogEnabled` | `true` | 运行时动态开关（与 env 联动） |
| 图形开关 | 系统设置 → 运维 → 日志维护 | 开 | 前端「记录完整请求体和响应体」开关，读写 Option 键 |

## 5. 定时清理

- **触发时机**：服务启动时 + 每 24 小时（goroutine 常驻，每次执行前检查功能开关——运行时开启开关后无需重启即可生效）
- **实现**：`time.NewTicker(24 * time.Hour)` + goroutine
- **清理逻辑**：`DELETE FROM request_response_logs WHERE created_at < cutoff`（按日期滚动，走 `created_at` 索引）
- **保留期 = 0 时**：不启动清理 goroutine，数据永久保留
- **日志输出**：删除数量 > 0 时输出 `SysLog`，错误时输出 `SysError`

## 6. 性能与容量估算

| 维度 | 评估 |
|---|---|
| 请求体存储 | 复用已有 BodyStorage；同步 `Bytes()` 读取一次（功能开启时） |
| 响应体缓存 | 全类型响应在内存 buffer 累积到请求结束（含 SSE）；长流式响应占用与内容等量的内存 |
| 写入次数 | **每请求恰好一次** UPSERT，不随流式分片数增长 |
| 写入时机 | `c.Next()` 后的 goroutine，不阻塞主链路 |
| 开关关闭时开销 | 零（中间件开头直接 `c.Next()` 返回） |
| 单条记录体积 | 不截断；流式响应为分片合并后的单个响应对象（通常远小于原始报文），未识别格式为原始 SSE 报文 |
| 7 天数据估算 | 按日期滚动清理兜底，总量 ≈ 日均请求量 × 平均体积 × 7 |

## 7. 数据库迁移

`migrateLOGDB()` 中增加 `AutoMigrate(&RequestResponseLog{})`（ClickHouse 分支提前 return，不迁移此表，并**显式禁用该功能**避免运行时写入报错），并在启动时执行一次过期清理。

**⚠️ 单库部署**：`LOG_SQL_DSN` 未配置时 `InitLogDB` 提前返回、不会调用 `migrateLOGDB()`，因此 `migrateDB()`（主库迁移）的 AutoMigrate 列表中也必须包含 `&RequestResponseLog{}`。

GORM 的 `AutoMigrate` 会自动创建 `request_response_logs` 表（如果不存在），并对已有表添加缺失的列/索引。

## 8. 依赖关系

```
middleware/response_recorder.go
  ├── common (RequestResponseLogEnabled, GetBodyStorage, RequestIdKey, SysLog)
  ├── gin (gin.ResponseWriter, gin.Context)
  ├── middleware/response_stream_merge.go (mergeStreamResponseBody，流式落库前合并)
  └── model.SaveRequestResponseLog (通过回调函数传入，避免循环导入)

middleware/response_stream_merge.go
  └── common (Marshal, UnmarshalJsonStr)

model/request_response_log.go
  ├── common (RequestResponseLogEnabled, GetTimestamp, SysLog, SysError)
  ├── gorm (gorm.DB, clauses.OnConflict, ErrRecordNotFound)
  └── time (Now, AddDate)

controller/request_response_log.go
  ├── common (ApiError, ApiSuccess, RoleAdminUser)
  ├── model (GetLogById, GetRequestResponseLogByRequestId)
  └── gin (gin.Context)

router/api-router.go
  └── middleware (AdminAuth, UserAuth)

router/relay-router.go
  ├── middleware (ResponseRecorderMiddleware)
  └── model (SaveRequestResponseLog)
```

## 9. 风险与注意事项

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| 存储膨胀 | 高频 + 大响应场景下数据增长快，且不截断 | 默认关闭 + 保留期按日期滚动清理 |
| 内存占用 | 响应（含 SSE 分片、二进制载荷）在内存累积到请求结束 | 网关单请求响应体通常为 MB 级；并发落库 goroutine 由信号量限流，日志库积压时丢弃新日志 |
| 循环导入 | middleware → model 可能产生循环 | 通过 `saveFunc` 回调注入，中间件不直接 import model |
| goroutine 竞态 | 异步保存 vs `BodyStorageCleanup` 清理请求体 | 请求体在 `c.Next()` 后同步读取，goroutine 只持有 string 副本 |
| 跨数据库兼容 | 大文本列类型差异 | 不加 type 标签，依赖 GORM 各方言默认映射；落库前净化非法 UTF-8 |
| gin 接口兼容 | `gin.ResponseWriter` 包含多个子接口 | 内嵌接口自动透传，仅覆写 `Write`/`WriteString`/`WriteHeader`；实现 `Unwrap()` 保证 `http.ResponseController` 可穿透（流式写超时保护依赖它） |
