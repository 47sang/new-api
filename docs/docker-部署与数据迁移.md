# Docker 部署与数据迁移指南

> 创建日期：2026-06-16  
> 关联项目：new-api (AI API 网关)

---

## 当前状况

| 项目 | 值 |
|---|---|
| 当前数据目录 | `/Users/zhou/Desktop/演示项目/new-api-data` |
| 数据库文件 | `one-api.db` (SQLite, ~6.8MB) |
| 日志目录 | `logs/` (~14MB) |
| Docker 运行状态 | 当前无运行中容器 |

---

## 完整操作步骤

```bash
# ─────────────────────────────────────────────
# 第一步：停止旧 Docker 容器（如果正在运行）
# ─────────────────────────────────────────────
cd /Users/zhou/Desktop/ai-agent-lab/new-api
docker compose down

# ─────────────────────────────────────────────
# 第二步：创建新数据目录并搬运数据
# ─────────────────────────────────────────────
mkdir -p /Users/zhou/Desktop/ai-agent-lab/new-api-data

# 复制数据库和日志（保留权限和时间戳）
cp -a /Users/zhou/Desktop/演示项目/new-api-data/* /Users/zhou/Desktop/ai-agent-lab/new-api-data/

# 验证复制结果
ls -la /Users/zhou/Desktop/ai-agent-lab/new-api-data/
# 期望输出：one-api.db 和 logs/ 目录

# ─────────────────────────────────────────────
# 第三步：修改 docker-compose.yml
# ─────────────────────────────────────────────
# 1. volumes 部分改成绝对路径：
#    将  - ./data:/data
#    改为  - /Users/zhou/Desktop/ai-agent-lab/new-api-data:/data
#
# 2. 在 environment 中添加新功能开关（默认关闭）：
#    - REQUEST_RESPONSE_LOG_ENABLED=false
#    - REQUEST_RESPONSE_LOG_TTL_DAYS=7
#
# 3. 二选一：本地构建 or 远程镜像
#    ┌─ 本地构建（包含新功能代码）───────────────────┐
#    │  注释掉 image 行，取消 build 行：              │
#    │  # image: calciumion/new-api:latest           │
#    │  build: .                                     │
#    └───────────────────────────────────────────────┘
#    ┌─ 远程镜像（不含新功能，需等代码合并发布）───────┐
#    │  保持 image 行不变，注释掉 build 行：           │
#    │  image: calciumion/new-api:latest             │
#    │  # build: .                                   │
#    └───────────────────────────────────────────────┘

# ─────────────────────────────────────────────
# 第四步：构建并启动
# ─────────────────────────────────────────────
docker compose build          # 编译包含新代码的镜像
docker compose up -d          # 后台启动

# ─────────────────────────────────────────────
# 第五步：验证
# ─────────────────────────────────────────────
docker compose ps             # 确认容器运行中
docker compose logs -f        # 查看启动日志，确认无报错

# 进入容器检查数据
docker compose exec new-api ls /data
# 期望输出：one-api.db  logs/

# 浏览器访问 http://localhost:3000 确认服务正常
```

---

## 数据搬运验证清单

| 检查项 | 命令 | 期望结果 |
|---|---|---|
| 数据库文件存在 | `ls -la /Users/zhou/Desktop/ai-agent-lab/new-api-data/one-api.db` | 文件大小 ~6.8MB |
| 日志目录存在 | `ls /Users/zhou/Desktop/ai-agent-lab/new-api-data/logs/` | 包含 .log 文件 |
| 容器内可访问 | `docker compose exec new-api ls /data` | 能看到 one-api.db |
| 服务正常运行 | `curl http://localhost:3000/api/status` | 返回 success: true |
| 新表自动创建 | 查看容器启动日志 | 无数据库迁移报错 |

---

## 回滚方案

如果新版本有问题，可以快速回滚：

```bash
# 停止当前容器
docker compose down

# 数据已在新的数据目录中，不会丢失
# 如需回到旧版本镜像：
# docker compose pull calciumion/new-api:previous-version
# docker compose up -d
```

---

## 注意事项

### 关于 Docker volume 路径

docker-compose.yml 中的 volumes 挂载建议使用**绝对路径**：

```yaml
volumes:
  - /Users/zhou/Desktop/ai-agent-lab/new-api-data:/data
```

这样无论从哪个目录执行 `docker compose up`，数据目录都不会变。

### 关于数据安全

- 搬运数据前建议先备份原目录（`cp -a` 已保留权限和时间戳）
- `docker compose down` 不会删除 volume 中的数据
- **SQLite 场景**：数据库文件存在宿主机目录（`/Users/zhou/Desktop/ai-agent-lab/new-api-data/one-api.db`），通过 volume 挂载进容器。只要宿主机目录不丢，数据就安全。**前提是 docker-compose.yml 的 volume 路径必须指向这个目录。**
- **PostgreSQL 场景**：数据存在 Docker volume（`pg_data`）中，搬运方式不同，需要用 `pg_dump` / `pg_restore` 导出导入，不能直接复制文件。

### 关于新表创建

启动新镜像后，GORM 的 `AutoMigrate` 会自动创建 `request_response_logs` 表，无需手动执行 SQL。SQLite / MySQL / PostgreSQL 均兼容。

### 关于构建方式

- **本地构建**（`build: .`）：Dockerfile 是多阶段构建（bun build → go build → debian slim），新增 Go 代码对构建过程零影响，镜像大小增加可忽略（~KB 级）。
- **远程镜像**（`image: calciumion/new-api:latest`）：不需要本地编译，但新功能代码必须等 PR 合并并发布新镜像后才能使用。

### 常见问题

**Q: 新数据目录已经存在且有旧数据怎么办？**  
A: `cp -a` 会覆盖同名文件，不会影响其他已有文件。建议执行前先备份：`cp -a /Users/zhou/Desktop/演示项目/new-api-data /Users/zhou/Desktop/演示项目/new-api-data.bak`

**Q: docker-compose down 会不会删掉 volume 里的数据？**  
A: 不会。`down` 只停止并删除容器，volume（包括 bind mount 的宿主机目录）不受影响。

**Q: 容器启动后看不到新表怎么办？**  
A: 检查容器启动日志：`docker compose logs new-api`。如果 `AutoMigrate` 报错，表不会被创建。确认 `LOG_DB` 连接的数据库是否正常（看 `SQL_DSN` 环境变量）。

**Q: 用远程镜像和本地 build 可以来回切换吗？**  
A: 可以。注释/取消注释对应的行即可。但注意：远程镜像不含新功能代码，开启 `REQUEST_RESPONSE_LOG_ENABLED=true` 也不会有任何效果（因为没有对应的处理逻辑）。
