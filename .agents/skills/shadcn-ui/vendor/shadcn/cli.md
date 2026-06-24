# shadcn CLI 参考

配置从 `components.json` 读取。

> **重要：** 始终使用项目的包运行器运行命令：`npx shadcn@latest`、`pnpm dlx shadcn@latest` 或 `bunx --bun shadcn@latest`。根据项目上下文检查 `packageManager` 以选择正确的运行器。下方示例使用 `npx shadcn@latest`，请替换为项目对应的运行器。

> **重要：** 只使用下方文档中列出的标志。切勿发明或猜测标志 —— 如果某个标志未在此列出，说明它不存在。CLI 会从项目的 lockfile 自动检测包管理器；没有 `--package-manager` 标志。

## 目录

- 命令：init、apply、add（dry-run、智能合并）、search、view、docs、info、build
- 模板：next、vite、start、react-router、astro
- 预设：命名、代码、URL 格式与字段
- 切换预设

---

## 命令

### `init` — 初始化或创建项目

```bash
npx shadcn@latest init [components...] [options]
```

在现有项目中初始化 shadcn/ui，或（提供 `--name` 时）创建新项目。也可在同一步骤中安装组件。

| 标志                    | 简写 | 描述                                            | 默认值  |
| ----------------------- | ---- | ----------------------------------------------- | ------- |
| `--template <template>` | `-t` | 模板（next、start、vite、next-monorepo、react-router） | —       |
| `--preset [name]`       | `-p` | 预设配置（命名、代码或 URL）                    | —       |
| `--yes`                 | `-y` | 跳过确认提示                                    | `true`  |
| `--defaults`            | `-d` | 使用默认值（`--template=next --preset=base-nova`）| `false` |
| `--force`               | `-f` | 强制覆盖现有配置                                | `false` |
| `--cwd <cwd>`           | `-c` | 工作目录                                        | 当前    |
| `--name <name>`         | `-n` | 新项目名称                                      | —       |
| `--silent`              | `-s` | 静默输出                                        | `false` |
| `--rtl`                 |      | 启用 RTL 支持                                   | —       |
| `--reinstall`           |      | 重新安装现有 UI 组件                            | `false` |
| `--monorepo`            |      | 脚手架生成 monorepo 项目                        | —       |
| `--no-monorepo`         |      | 跳过 monorepo 提示                              | —       |

`npx shadcn@latest create` 是 `npx shadcn@latest init` 的别名。

### `apply` — 向现有项目应用预设

```bash
npx shadcn@latest apply [preset] [options]
```

向现有项目应用预设，覆盖预设驱动的配置、字体、CSS 变量和检测到的 UI 组件。

| 标志                | 简写 | 描述                            | 默认值 |
| ------------------- | ---- | ------------------------------- | ------ |
| `--preset <preset>` | —    | 预设配置（命名、代码或 URL）    | —      |
| `--yes`             | `-y` | 跳过确认提示                    | `false`|
| `--cwd <cwd>`       | `-c` | 工作目录                        | 当前   |
| `--silent`          | `-s` | 静默输出                        | `false`|

`[preset]` 是 `--preset <preset>` 的简写。如果两者都提供，必须一致。
如果未提供预设，CLI 会提议在 `ui.shadcn.com/create` 上打开自定义预设构建器。

### `add` — 添加组件

> **重要：** 要将本地组件与上游对比或预览变更，**始终**使用 `npx shadcn@latest add <component> --dry-run`、`--diff` 或 `--view`。**切勿**手动从 GitHub 或其他来源获取原始文件。CLI 会自动处理注册表解析、文件路径和 CSS 差异比对。

```bash
npx shadcn@latest add [components...] [options]
```

接受组件名、带注册表前缀的名称（`@magicui/shimmer-button`）、URL 或本地路径。

| 标志            | 简写 | 描述                                                                                                              | 默认值  |
| --------------- | ---- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| `--yes`         | `-y` | 跳过确认提示                                                                                                      | `false` |
| `--overwrite`   | `-o` | 覆盖现有文件                                                                                                      | `false` |
| `--cwd <cwd>`   | `-c` | 工作目录                                                                                                          | 当前    |
| `--all`         | `-a` | 添加所有可用组件                                                                                                  | `false` |
| `--path <path>` | `-p` | 组件的目标路径                                                                                                    | —       |
| `--silent`      | `-s` | 静默输出                                                                                                          | `false` |
| `--dry-run`     |      | 预览所有变更但不写入文件                                                                                          | `false` |
| `--diff [path]` |      | 显示差异。不带路径时显示前 5 个文件。带路径时仅显示该文件（隐含 `--dry-run`）                                     | —       |
| `--view [path]` |      | 显示文件内容。不带路径时显示前 5 个文件。带路径时仅显示该文件（隐含 `--dry-run`）                                 | —       |

#### Dry-Run 模式

使用 `--dry-run` 预览 `add` 会做什么而不写入任何文件。`--diff` 和 `--view` 都隐含 `--dry-run`。

```bash
# 预览所有变更。
npx shadcn@latest add button --dry-run

# 显示所有文件的差异（前 5 个）。
npx shadcn@latest add button --diff

# 显示特定文件的差异。
npx shadcn@latest add button --diff button.tsx

# 显示所有文件的内容（前 5 个）。
npx shadcn@latest add button --view

# 显示特定文件的完整内容。
npx shadcn@latest add button --view button.tsx

# 也适用于 URL。
npx shadcn@latest add https://api.npoint.io/abc123 --dry-run

# CSS 差异。
npx shadcn@latest add button --diff globals.css
```

**何时使用 dry-run：**

- 用户问"这会添加哪些文件？"或"这会改什么？"时 —— 使用 `--dry-run`。
- 覆盖现有组件前 —— 先用 `--diff` 预览变更。
- 用户想在不安装的情况下检查组件源代码时 —— 使用 `--view`。
- 检查会对 `globals.css` 做哪些 CSS 变更时 —— 使用 `--diff globals.css`。
- 用户要求在安装前审查或审计第三方注册表代码时 —— 使用 `--view` 检查源码。

> **`npx shadcn@latest add --dry-run` vs `npx shadcn@latest view`：** 当用户想预览对其项目的变更时，优先使用 `npx shadcn@latest add --dry-run/--diff/--view` 而非 `npx shadcn@latest view`。`npx shadcn@latest view` 仅显示原始注册表元数据。`npx shadcn@latest add --dry-run` 显示在用户项目中实际会发生什么：解析后的文件路径、与现有文件的差异、CSS 更新。仅在用户想浏览无项目上下文的注册表信息时才使用 `npx shadcn@latest view`。

#### 从上游智能合并

完整工作流参见 [SKILL.md 中的更新组件](./SKILL.md#updating-components)。

### `search` — 搜索注册表

```bash
npx shadcn@latest search <registries...> [options]
```

跨注册表的模糊搜索。别名也是 `npx shadcn@latest list`。不带 `-q` 时列出所有项。

| 标志                | 简写 | 描述              | 默认值 |
| ------------------- | ---- | ----------------- | ------ |
| `--query <query>`   | `-q` | 搜索查询          | —      |
| `--limit <number>`  | `-l` | 每个注册表最大项数| `100`  |
| `--offset <number>` | `-o` | 跳过的项数        | `0`    |
| `--cwd <cwd>`       | `-c` | 工作目录          | 当前   |

### `view` — 查看项详情

```bash
npx shadcn@latest view <items...> [options]
```

显示项信息，包含文件内容。例如：`npx shadcn@latest view @shadcn/button`。

### `docs` — 获取组件文档 URL

```bash
npx shadcn@latest docs <components...> [options]
```

输出组件文档、示例和 API 参考的解析后 URL。接受一个或多个组件名。获取这些 URL 即可得到实际内容。

`npx shadcn@latest docs input button` 的示例输出：

```
base  radix

input
  docs      https://ui.shadcn.com/docs/components/radix/input
  examples  https://raw.githubusercontent.com/.../examples/input-example.tsx

button
  docs      https://ui.shadcn.com/docs/components/radix/button
  examples  https://raw.githubusercontent.com/.../examples/button-example.tsx
```

部分组件包含指向底层库的 `api` 链接（如 command 组件的 `cmdk`）。

### `diff` — 检查更新

不要使用此命令。请改用 `npx shadcn@latest add --diff`。

### `info` — 项目信息

```bash
npx shadcn@latest info [options]
```

显示项目信息和 `components.json` 配置。首先运行此命令以发现项目的框架、别名、Tailwind 版本和解析后的路径。

| 标志          | 简写 | 描述     | 默认值 |
| ------------- | ---- | -------- | ------ |
| `--cwd <cwd>` | `-c` | 工作目录 | 当前   |

**项目信息字段：**

| 字段                 | 类型      | 含义                                                          |
| -------------------- | --------- | ------------------------------------------------------------- |
| `framework`          | `string`  | 检测到的框架（`next`、`vite`、`react-router`、`start` 等）    |
| `frameworkVersion`   | `string`  | 框架版本（如 `15.2.4`）                                       |
| `isSrcDir`           | `boolean` | 项目是否使用 `src/` 目录                                      |
| `isRSC`              | `boolean` | 是否启用了 React Server Components                            |
| `isTsx`              | `boolean` | 项目是否使用 TypeScript                                       |
| `tailwindVersion`    | `string`  | `"v3"` 或 `"v4"`                                              |
| `tailwindConfigFile` | `string`  | Tailwind 配置文件路径                                         |
| `tailwindCssFile`    | `string`  | 全局 CSS 文件路径                                             |
| `aliasPrefix`        | `string`  | 导入别名前缀（如 `@`、`~`、`@/`）                             |
| `packageManager`     | `string`  | 检测到的包管理器（`npm`、`pnpm`、`yarn`、`bun`）              |

**components.json 字段：**

| 字段                 | 类型      | 含义                                                                                        |
| -------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `base`               | `string`  | 基础库（`radix` 或 `base`）—— 决定组件 API 和可用属性                                       |
| `style`              | `string`  | 视觉风格（如 `nova`、`vega`）                                                               |
| `rsc`                | `boolean` | 配置中的 RSC 标志                                                                           |
| `tsx`                | `boolean` | TypeScript 标志                                                                             |
| `tailwind.config`    | `string`  | Tailwind 配置路径                                                                           |
| `tailwind.css`       | `string`  | 全局 CSS 路径 —— 这是放置自定义 CSS 变量的位置                                              |
| `iconLibrary`        | `string`  | 图标库 —— 决定图标导入包（如 `lucide-react`、`@tabler/icons-react`）                        |
| `aliases.components` | `string`  | 组件导入别名（如 `@/components`）                                                           |
| `aliases.utils`      | `string`  | 工具导入别名（如 `@/lib/utils`）                                                            |
| `aliases.ui`         | `string`  | UI 组件别名（如 `@/components/ui`）                                                         |
| `aliases.lib`        | `string`  | Lib 别名（如 `@/lib`）                                                                      |
| `aliases.hooks`      | `string`  | Hooks 别名（如 `@/hooks`）                                                                  |
| `resolvedPaths`      | `object`  | 每个别名的绝对文件系统路径                                                                  |
| `registries`         | `object`  | 已配置的自定义注册表                                                                        |

**Links 字段：**

`info` 输出包含一个 **Links** 部分，提供组件文档、源码和示例的模板化 URL。如需解析后的 URL，请改用 `npx shadcn@latest docs <component>`。

### `build` — 构建自定义注册表

```bash
npx shadcn@latest build [registry] [options]
```

将 `registry.json` 构建为单个 JSON 文件以供分发。默认输入：`./registry.json`，默认输出：`./public/r`。

| 标志              | 简写 | 描述     | 默认值       |
| ----------------- | ---- | -------- | ------------ |
| `--output <path>` | `-o` | 输出目录 | `./public/r` |
| `--cwd <cwd>`     | `-c` | 工作目录 | 当前         |

---

## 模板

| 值              | 框架          | Monorepo 支持 |
| --------------- | ------------- | ------------- |
| `next`         | Next.js       | 是            |
| `vite`         | Vite          | 是            |
| `start`        | TanStack Start| 是            |
| `react-router` | React Router  | 是            |
| `astro`        | Astro         | 是            |
| `laravel`      | Laravel       | 否            |

所有模板都通过 `--monorepo` 标志支持 monorepo 脚手架。传入该标志时，CLI 使用 monorepo 专用模板目录（如 `next-monorepo`、`vite-monorepo`）。当既未传 `--monorepo` 也未传 `--no-monorepo` 时，CLI 会交互式提示。Laravel 不支持 monorepo 脚手架。

---

## 预设

通过 `--preset` 指定预设的三种方式：

1. **命名：** `--preset nova` 或 `--preset lyra`
2. **代码：** `--preset a2r6bw`（带版本前缀的 base62 字符串，如 `a2r6bw` 或 `b0`）
3. **URL：** `--preset "https://ui.shadcn.com/init?base=radix&style=nova&..."`

> **重要：** 切勿尝试手动解码、获取或解析预设代码。预设代码是不透明的 —— 直接传递给 `npx shadcn@latest init --preset <code>` 让 CLI 处理解析。
> 覆盖现有项目的预设时使用 `npx shadcn@latest apply --preset <code>`。

## 切换预设

先询问用户：**覆盖**、**合并**，还是**跳过**现有组件？

- **覆盖 / 重装** → `npx shadcn@latest apply --preset <code>`。用新预设样式覆盖所有检测到的组件文件。当用户未自定义组件时使用。
- **合并** → `npx shadcn@latest init --preset <code> --force --no-reinstall`，然后运行 `npx shadcn@latest info` 获取已安装组件列表，并使用[智能合并工作流](./SKILL.md#updating-components)逐个更新，保留本地修改。当用户自定义过组件时使用。
- **跳过** → `npx shadcn@latest init --preset <code> --force --no-reinstall`。仅更新配置和 CSS 变量，组件保持不变。

始终在用户的项目目录内运行预设命令。`apply` 仅在带有 `components.json` 文件的现有项目中有效。CLI 会自动从 `components.json` 保留当前的 base（`base` vs `radix`）。如果必须使用临时/草稿目录（如用于 `--dry-run` 比较），请显式传入 `--base <current-base>` —— 预设代码不编码 base。
