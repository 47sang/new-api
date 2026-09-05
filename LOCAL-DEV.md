# 本地开发指南

> 本文档整理自 `AGENTS.md`、`Makefile`、`docker-compose*.yml`、`main.go`、`web/rsbuild.config.ts`。
> 最后更新：2026-09-04

---

## 📊 三种方案速查表

| 场景 | 方案 | 命令入口 | 数据库 | 适用情况 |
|---|---|---|---|---|
| 🚫 **不想用 Docker** | 1 · 全本地双终端 | `go run` + `bun run dev` | SQLite | 轻量本地联调 |
| 🔧 **改后端 Go 代码** | 2 · 本地 `go run` + SQLite | `go run main.go` | SQLite | 秒级重启，无外部依赖 |
| 🎨 **改前端 / 前后端联调** | 3 · Docker 后端 + 本地前端 | `make dev-api` + `make dev-web` | PostgreSQL + Redis | 前端 HMR，最接近生产 |

---

## 🚫 方案 1 · 全本地双终端

```bash
# 终端 1: 后端
go run main.go

# 终端 2: 前端
cd web && bun install && bun run dev
# → http://localhost:5173
```

若 `go:embed` 报错（`web/dist` 缺失或过期）：
```bash
make build-web
```

---

## 🔧 方案 2 · 本地 `go run` + SQLite

```bash
# 最简启动
go run main.go
# → http://localhost:3000（内嵌前端）

# 换端口（两种方式）
PORT=3001 go run main.go
go run main.go --port 3001

# 指定 SQLite 文件路径
SQLITE_PATH=/tmp/dev.db go run main.go

# 带调试日志
DEBUG=true go run main.go
```

**优点**：单进程、秒级重启、无任何外部依赖。
**缺点**：看的是 `web/dist` 里的旧版前端，Go 改动需手动重启。

---

## 🎨 方案 3 · Docker 后端 + 本地前端（推荐）

```bash
# ① 启动后端（本地源码构建）+ PostgreSQL + Redis
make dev-api

# ② 启动前端 Rsbuild dev server（新终端）
make dev-web
# → http://localhost:5173
# /api、/v1、/mj、/pg 自动代理到 :3000

# ③ Go 代码改了，重建后端镜像
make dev-api-rebuild

# ④ 重置初始化向导状态（想重新走 setup 流程）
make reset-setup

# ⑤ 停止
docker compose -f docker-compose.dev.yml down

# ⑥ 停止并清空所有数据（含数据库）
docker compose -f docker-compose.dev.yml down -v
```

**前端代理配置**：`web/rsbuild.config.ts:19-24` 已配好四类路径代理到 `http://localhost:3000`。

**⚠️ 注意**：
- `SESSION_COOKIE_SECURE=false` 已在 `docker-compose.dev.yml:35` 设好，别删，否则代理登录会话会失败。
- Go 改动无热重载，必须 `make dev-api-rebuild`。
- 数据卷：`dev_pg_data`（PostgreSQL）/ `dev_data`（应用数据）。

---

## 🐞 调试手段

### Delve 断点调试

```bash
# 命令行
dlv debug main.go -- --port 3000

# VS Code launch.json
{
  "name": "debug new-api",
  "type": "go",
  "request": "launch",
  "mode": "debug",
  "program": "${workspaceFolder}",
  "env": { "DEBUG": "true", "SQLITE_PATH": "one-api.db" }
}
```

### 内置诊断开关

| 手段 | 开启方式 | 访问位置 |
|---|---|---|
| 调试日志 | `DEBUG=true` | 标准输出 |
| 性能剖析 pprof | `ENABLE_PPROF=true` | `http://localhost:8005/debug/pprof` |
| 持续性能分析 | `PYROSCOPE_URL=...` | Pyroscope |
| 落盘日志 | `--log-dir ./logs` | `logs/` 目录 |
| Gin 路由详情 | `GIN_MODE=debug` | 标准输出 |

### 测试

```bash
make test                                  # 根模块 + relaykit 全部 Go 测试
cd web && bun run test                     # 前端 vitest
cd web && bun run typecheck                # tsgo 类型检查
cd relaykit && GOWORK=off go build ./...   # relaykit 独立构建验证
```

---

## ⚠️ 常见坑

1. **首次启动会进初始化向导**（创建 root 用户），`make reset-setup` 可重置。
2. **Redis 是软依赖但有陷阱**：不配 `REDIS_CONN_STRING` 就单机内存运行；配了但连不上会 `FatalLog` 直接退出，不会静默降级。
3. **`NODE_TYPE=slave` 跳过数据库迁移**，单机调试不用管（默认 master）。
4. **`web/dist` 缺失**：`go:embed` 会失败，先 `make build-web`。
5. **`go.mod` 有 replace 指令**：`relaykit` 是本地子模块（`replace github.com/QuantumNous/new-api/relaykit => ./relaykit`），验证时需 `cd relaykit && GOWORK=off go build ./...`。
6. **worktree 隔离**：若在 `.claude/worktrees/` 下工作，SQLite 文件、`.env`、日志都落在该 worktree 目录内，与主目录互不干扰。
