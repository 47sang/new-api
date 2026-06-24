---
name: shadcn-ui
description: >-
  为助手提供项目感知的 shadcn/ui 上下文：components.json、组合模式、CLI、
  注册表、主题和 MCP。在操作 web/default UI、shadcn 组件或预设时使用。
  概览内容与 https://ui.shadcn.com/docs/skills.md 对齐；
  完整的上游技能文本托管在 vendor/shadcn/ 下。
---

<!-- 官方概览来源：https://ui.shadcn.com/docs/skills.md -->

# 技能（shadcn/ui）

技能为 AI 助手提供关于 shadcn/ui 的项目感知上下文。使用后，助手将了解如何使用适合你项目的正确 API 和模式来查找、安装、组合和自定义组件。

例如，你可以这样要求：

- _"添加一个带邮箱和密码字段的登录表单。"_
- _"创建一个设置页面，包含用于更新个人信息的表单。"_
- _"构建一个带侧边栏、统计卡片和数据表格的仪表盘。"_
- _"切换到 --preset [编码]"_
- _"你能从 @tailark 添加一个 hero 区块吗？"_

该技能会读取项目的 `components.json`，并提供你的框架、别名、已安装的组件、图标库和基础库信息，以便一次生成正确的代码。

---

## 安装（官方生态 vs 本仓库）

官方安装方式参考 [Skills — shadcn/ui](https://ui.shadcn.com/docs/skills.md)：

```bash
npx skills add shadcn/ui
```

上述命令在 `skills` CLI 可用的位置安装技能。**本仓库** 将相同意图保存在 `.agents/skills/shadcn-ui/` 下（此处为概览 + ** vendored ** 上游文档见 [`vendor/shadcn/`](./vendor/shadcn/)），并从前端应用根目录运行 shadcn CLI：

```bash
cd web/default && bunx shadcn@latest info --json
```

了解更多关于技能的信息，请访问 [skills.sh](https://skills.sh)。

---

## 包含内容（及位置）

### 项目上下文

运行 **`shadcn info --json`**（本项目：`cd web/default && bunx shadcn@latest info --json`）获取框架、Tailwind 版本、别名、基础库（`radix` | `base`）、图标库、已安装的组件和解析后的路径。

### CLI 命令

完整命令参考（ vendored ）：[`vendor/shadcn/cli.md`](./vendor/shadcn/cli.md)。

### 主题与自定义

Vendored：[`vendor/shadcn/customization.md`](./vendor/shadcn/customization.md)。在线文档：[Theming](https://ui.shadcn.com/docs/theming)。

### 注册表编写

未在 vendor 目录下作为单一文件复制；参考 [Registry](https://ui.shadcn.com/docs/registry) 和 [`vendor/shadcn/cli.md`](./vendor/shadcn/cli.md) 中的 `build` 部分。

### MCP 服务器

Vendored：[`vendor/shadcn/mcp.md`](./vendor/shadcn/mcp.md)。在线文档：[MCP Server](https://ui.shadcn.com/docs/mcp)。

---

## 工作原理

1. **项目检测** — 当存在 `components.json` 时生效（本项目：`web/default/components.json`）。
2. **上下文注入** — 使用 `shadcn info --json` 作为导入和 API 的基准真相。
3. **模式强制** — 遵循 [`vendor/shadcn/SKILL.md`](./vendor/shadcn/SKILL.md) 和 [`vendor/shadcn/rules/`](./vendor/shadcn/rules/) 中的规则。
4. **组件发现** — `shadcn docs`、`shadcn search`、MCP 或注册表 — 参见 vendored 的 SKILL + MCP 文档。

---

## 了解更多（web）

- [CLI](https://ui.shadcn.com/docs/cli) — 补充 [`vendor/shadcn/cli.md`](./vendor/shadcn/cli.md)
- [Theming](https://ui.shadcn.com/docs/theming)
- [Registry](https://ui.shadcn.com/docs/registry)
- [skills.sh](https://skills.sh)

---

## Vendored 上游包（深度规则）

来自 [shadcn-ui/ui `skills/shadcn`](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn) 的快照；版本说明见 [`vendor/shadcn/UPSTREAM.txt`](./vendor/shadcn/UPSTREAM.txt)。

| 文档 | 路径 |
| --- | --- |
| 完整官方技能正文 | [`vendor/shadcn/SKILL.md`](./vendor/shadcn/SKILL.md) |
| CLI 参考 | [`vendor/shadcn/cli.md`](./vendor/shadcn/cli.md) |
| 主题/自定义 | [`vendor/shadcn/customization.md`](./vendor/shadcn/customization.md) |
| MCP | [`vendor/shadcn/mcp.md`](./vendor/shadcn/mcp.md) |
| 表单 | [`vendor/shadcn/rules/forms.md`](./vendor/shadcn/rules/forms.md) |
| 组合 | [`vendor/shadcn/rules/composition.md`](./vendor/shadcn/rules/composition.md) |
| 图标 | [`vendor/shadcn/rules/icons.md`](./vendor/shadcn/rules/icons.md) |
| 样式 | [`vendor/shadcn/rules/styling.md`](./vendor/shadcn/rules/styling.md) |
| Base vs Radix | [`vendor/shadcn/rules/base-vs-radix.md`](./vendor/shadcn/rules/base-vs-radix.md) |

**工作流：** 本仓库根目录的 `SKILL.md` 用于项目路径（`web/default`、Bun）。阅读 **`vendor/shadcn/SKILL.md`** 获取完整的上游工作流、模式和 CLI 快速参考。在验证具体标记时使用 **`vendor/shadcn/rules/*.md`**。
