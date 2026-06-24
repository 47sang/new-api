# shadcn MCP 服务器

CLI 内置了一个 MCP 服务器，让 AI 助手能够从注册表中搜索、浏览、查看和安装组件。

---

## 安装配置

```bash
shadcn mcp        # 启动 MCP 服务器（stdio）
shadcn mcp init   # 为你的编辑器写入配置
```

编辑器配置文件：

| 编辑器 | 配置文件 |
|--------|----------|
| Claude Code | `.mcp.json` |
| Cursor | `.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` |
| OpenCode | `opencode.json` |
| Codex | `~/.codex/config.toml`（手动配置） |

---

## 工具

> **提示：** MCP 工具负责注册表相关操作（搜索、查看、安装）。对于项目配置（别名、框架、Tailwind 版本），请使用 `npx shadcn@latest info` —— 没有对应的 MCP 等价功能。

### `shadcn:get_project_registries`

返回 `components.json` 中的注册表名称。如果不存在 `components.json` 则报错。

**输入：** 无

### `shadcn:list_items_in_registries`

列出一个或多个注册表中的所有项目。

**输入：** `registries`（字符串数组）、`limit`（数字，可选）、`offset`（数字，可选）

### `shadcn:search_items_in_registries`

跨注册表的模糊搜索。

**输入：** `registries`（字符串数组）、`query`（字符串）、`limit`（数字，可选）、`offset`（数字，可选）

### `shadcn:view_items_in_registries`

查看项目详情，包含完整文件内容。

**输入：** `items`（字符串数组）— 例如 `["@shadcn/button", "@shadcn/card"]`

### `shadcn:get_item_examples_from_registries`

查找使用示例和演示代码。

**输入：** `registries`（字符串数组）、`query`（字符串）— 例如 `"accordion-demo"`、`"button example"`

### `shadcn:get_add_command_for_items`

返回 CLI 安装命令。

**输入：** `items`（字符串数组）— 例如 `["@shadcn/button"]`

### `shadcn:get_audit_checklist`

返回用于校验组件的检查清单（导入、依赖、lint、TypeScript）。

**输入：** 无

---

## 配置注册表

注册表在 `components.json` 中配置。`@shadcn` 注册表始终是内置的。

```json
{
  "registries": {
    "@acme": "https://acme.com/r/{name}.json",
    "@private": {
      "url": "https://private.com/r/{name}.json",
      "headers": { "Authorization": "Bearer ${MY_TOKEN}" }
    }
  }
}
```

- 名称必须以 `@` 开头。
- URL 必须包含 `{name}`。
- `${VAR}` 引用会从环境变量中解析。

社区注册表索引：`https://ui.shadcn.com/r/registries.json`
