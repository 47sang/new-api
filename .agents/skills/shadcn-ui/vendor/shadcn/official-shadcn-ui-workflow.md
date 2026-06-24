---
name: shadcn
description: 管理 shadcn 组件与项目 —— 添加、搜索、修复、调试、样式设置与 UI 组合。提供项目上下文、组件文档和使用示例。适用于使用 shadcn/ui、组件注册表、预设、--preset 代码，或任何带有 components.json 文件的项目。也会在 "shadcn init"、"使用 --preset 创建应用" 或 "切换到 --preset" 时触发。
user-invocable: false
allowed-tools: Bash(npx shadcn@latest *), Bash(pnpm dlx shadcn@latest *), Bash(bunx --bun shadcn@latest *)
---

# shadcn/ui

一个用于构建 UI、组件和设计系统的框架。组件通过 CLI 以源代码形式添加到用户项目中。

> **重要：** 始终使用项目的包运行器运行所有 CLI 命令：`npx shadcn@latest`、`pnpm dlx shadcn@latest` 或 `bunx --bun shadcn@latest` —— 根据项目的 `packageManager` 选择。下方示例使用 `npx shadcn@latest`，请替换为项目对应的运行器。

## 当前项目上下文

```json
!`npx shadcn@latest info --json`
```

上方 JSON 包含项目配置和已安装的组件。使用 `npx shadcn@latest docs <component>` 获取任意组件的文档和示例 URL。

## 原则

1. **优先使用现有组件。** 编写自定义 UI 前，先用 `npx shadcn@latest search` 检查注册表。也要检查社区注册表。
2. **组合，而非重新发明。** 设置页 = Tabs + Card + 表单控件。仪表盘 = Sidebar + Card + Chart + Table。
3. **自定义样式前先使用内置变体。** `variant="outline"`、`size="sm"` 等。
4. **使用语义化颜色。** `bg-primary`、`text-muted-foreground` —— 切勿使用 `bg-blue-500` 这类原始值。

## 关键规则

这些规则**始终生效**。每条都链接到包含错误/正确代码对比的文件。

### 样式与 Tailwind → [styling.md](./rules/styling.md)

- **`className` 用于布局，而非样式。** 切勿覆盖组件颜色或排版。
- **不使用 `space-x-*` 或 `space-y-*`。** 改用带 `gap-*` 的 `flex`。垂直堆叠使用 `flex flex-col gap-*`。
- **宽高相等时使用 `size-*`。** 使用 `size-10` 而非 `w-10 h-10`。
- **使用 `truncate` 简写。** 而非 `overflow-hidden text-ellipsis whitespace-nowrap`。
- **不手动覆盖 `dark:` 颜色。** 使用语义化令牌（`bg-background`、`text-muted-foreground`）。
- **使用 `cn()` 处理条件类。** 切勿手写模板字符串的三元表达式。
- **覆盖层组件不手动设置 `z-index`。** Dialog、Sheet、Popover 等自行处理层叠顺序。

### 表单与输入控件 → [forms.md](./rules/forms.md)

- **表单使用 `FieldGroup` + `Field`。** 切勿使用带 `space-y-*` 或 `grid gap-*` 的原始 `div` 作为表单布局。
- **`InputGroup` 使用 `InputGroupInput`/`InputGroupTextarea`。** 切勿在 `InputGroup` 内使用原始 `Input`/`Textarea`。
- **输入框内的按钮使用 `InputGroup` + `InputGroupAddon`。**
- **选项组（2–7 个）使用 `ToggleGroup`。** 切勿循环 `Button` 并手动维护激活状态。
- **使用 `FieldSet` + `FieldLegend` 分组相关复选框/单选框。** 切勿使用带标题的 `div`。
- **字段校验使用 `data-invalid` + `aria-invalid`。** `Field` 上放 `data-invalid`，控件上放 `aria-invalid`。禁用时：`Field` 上放 `data-disabled`，控件上放 `disabled`。

### 组件结构 → [composition.md](./rules/composition.md)

- **Item 始终放在对应的 Group 内。** `SelectItem` → `SelectGroup`。`DropdownMenuItem` → `DropdownMenuGroup`。`CommandItem` → `CommandGroup`。
- **自定义触发器使用 `asChild`（radix）或 `render`（base）。** 通过 `npx shadcn@latest info` 检查 `base` 字段。→ [base-vs-radix.md](./rules/base-vs-radix.md)
- **Dialog、Sheet 和 Drawer 始终需要 Title。** 出于可访问性，`DialogTitle`、`SheetTitle`、`DrawerTitle` 是必需的。视觉上隐藏时使用 `className="sr-only"`。
- **使用完整的 Card 组合。** `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`。切勿把所有内容都塞进 `CardContent`。
- **Button 没有 `isPending`/`isLoading`。** 用 `Spinner` + `data-icon` + `disabled` 组合。
- **`TabsTrigger` 必须在 `TabsList` 内。** 切勿直接在 `Tabs` 中渲染触发器。
- **`Avatar` 始终需要 `AvatarFallback`。** 用于图片加载失败时。

### 使用组件，而非自定义标记 → [composition.md](./rules/composition.md)

- **自定义标记前先使用现有组件。** 编写带样式的 `div` 前先检查是否存在对应组件。
- **提示框使用 `Alert`。** 切勿构建自定义样式 div。
- **空状态使用 `Empty`。** 切勿构建自定义空状态标记。
- **通过 `sonner` 实现 Toast。** 使用 `sonner` 的 `toast()`。
- **使用 `Separator`** 而非 `<hr>` 或 `<div className="border-t">`。
- **使用 `Skeleton`** 作为加载占位符。不要自定义 `animate-pulse` div。
- **使用 `Badge`** 而非自定义样式 span。

### 图标 → [icons.md](./rules/icons.md)

- **Button 内的图标使用 `data-icon`。** 图标上加 `data-icon="inline-start"` 或 `data-icon="inline-end"`。
- **组件内的图标不加尺寸类。** 组件通过 CSS 处理图标尺寸。不要加 `size-4` 或 `w-4 h-4`。
- **以对象形式传递图标，而非字符串键。** 使用 `icon={CheckIcon}`，而非字符串查找。

### CLI

- **切勿手动解码预设代码或构建预设 URL。** 使用 `npx shadcn@latest preset decode <code>`、`preset url <code>` 或 `preset open <code>`。对于感知项目的预设检测，使用 `npx shadcn@latest preset resolve`。
- **直接用 CLI 应用预设代码。** 现有项目使用 `npx shadcn@latest apply <code>`，初始化时使用 `npx shadcn@latest init --preset <code>`。

## 关键模式

这些是区分正确 shadcn/ui 代码的最常见模式。边缘情况参见上方链接的规则文件。

```tsx
// 表单布局：FieldGroup + Field，而非 div + Label。
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input id="email" />
  </Field>
</FieldGroup>

// 校验：Field 上 data-invalid，控件上 aria-invalid。
<Field data-invalid>
  <FieldLabel>Email</FieldLabel>
  <Input aria-invalid />
  <FieldDescription>Invalid email.</FieldDescription>
</Field>

// 按钮内图标：data-icon，不加尺寸类。
<Button>
  <SearchIcon data-icon="inline-start" />
  Search
</Button>

// 间距：gap-*，而非 space-y-*。
<div className="flex flex-col gap-4">  // 正确
<div className="space-y-4">           // 错误

// 相等尺寸：size-*，而非 w-* h-*。
<Avatar className="size-10">   // 正确
<Avatar className="w-10 h-10"> // 错误

// 状态颜色：Badge 变体或语义化令牌，而非原始颜色。
<Badge variant="secondary">+20.1%</Badge>    // 正确
<span className="text-emerald-600">+20.1%</span> // 错误
```

## 组件选择

| 需求                        | 使用                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| 按钮/操作                   | 使用合适变体的 `Button`                                                                              |
| 表单输入                    | `Input`、`Select`、`Combobox`、`Switch`、`Checkbox`、`RadioGroup`、`Textarea`、`InputOTP`、`Slider`  |
| 在 2–5 个选项间切换         | `ToggleGroup` + `ToggleGroupItem`                                                                    |
| 数据展示                    | `Table`、`Card`、`Badge`、`Avatar`                                                                   |
| 导航                        | `Sidebar`、`NavigationMenu`、`Breadcrumb`、`Tabs`、`Pagination`                                      |
| 覆盖层                      | `Dialog`（模态）、`Sheet`（侧边面板）、`Drawer`（底部面板）、`AlertDialog`（确认）                   |
| 反馈                        | `sonner`（toast）、`Alert`、`Progress`、`Skeleton`、`Spinner`                                        |
| 命令面板                    | 放在 `Dialog` 内的 `Command`                                                                         |
| 图表                        | `Chart`（封装 Recharts）                                                                             |
| 布局                        | `Card`、`Separator`、`Resizable`、`ScrollArea`、`Accordion`、`Collapsible`                           |
| 空状态                      | `Empty`                                                                                              |
| 菜单                        | `DropdownMenu`、`ContextMenu`、`Menubar`                                                             |
| 工具提示/信息               | `Tooltip`、`HoverCard`、`Popover`                                                                    |

## 关键字段

注入的项目上下文包含这些关键字段：

- **`aliases`** → 导入时使用实际的别名前缀（如 `@/`、`~/`），切勿硬编码。
- **`isRSC`** → 当为 `true` 时，使用 `useState`、`useEffect`、事件处理器或浏览器 API 的组件需要在文件顶部加 `"use client"`。就此指令提供建议时始终参考此字段。
- **`tailwindVersion`** → `"v4"` 使用 `@theme inline` 块；`"v3"` 使用 `tailwind.config.js`。
- **`tailwindCssFile`** → 定义自定义 CSS 变量的全局 CSS 文件。始终编辑此文件，切勿新建。
- **`style`** → 组件视觉风格（如 `nova`、`vega`）。
- **`base`** → 基础库（`radix` 或 `base`）。影响组件 API 和可用属性。
- **`iconLibrary`** → 决定图标导入。`lucide` 用 `lucide-react`，`tabler` 用 `@tabler/icons-react` 等。切勿假设为 `lucide-react`。
- **`resolvedPaths`** → 组件、工具、钩子等的精确文件系统目标位置。
- **`framework`** → 路由和文件约定（如 Next.js App Router vs Vite SPA）。
- **`packageManager`** → 用于任何非 shadcn 的依赖安装（如 `pnpm add date-fns` vs `npm install date-fns`）。
- **`preset`** → 当前项目解析后的预设代码和值。仅需预设信息时使用 `npx shadcn@latest preset resolve --json`。

完整字段参考见 [cli.md — `info` 命令](./cli.md)。

## 组件文档、示例与用法

运行 `npx shadcn@latest docs <component>` 获取组件文档、示例和 API 参考的 URL。获取这些 URL 即可得到实际内容。

```bash
npx shadcn@latest docs button dialog select
```

**创建、修复、调试或使用组件时，始终先运行 `npx shadcn@latest docs` 并获取这些 URL。** 这能确保你使用的是正确的 API 和用法模式，而非凭猜测。

## 工作流程

1. **获取项目上下文** —— 上方已注入。需要刷新时再次运行 `npx shadcn@latest info`。
2. **先检查已安装组件** —— 运行 `add` 前，始终检查项目上下文中的 `components` 列表或列出 `resolvedPaths.ui` 目录。不要导入尚未添加的组件，也不要重复添加已安装的组件。
3. **查找组件** —— `npx shadcn@latest search`。
4. **获取文档和示例** —— 运行 `npx shadcn@latest docs <component>` 获取 URL，然后获取它们。使用 `npx shadcn@latest view` 浏览尚未安装的注册表项。要预览已安装组件的变更，使用 `npx shadcn@latest add --diff`。
5. **安装或更新** —— `npx shadcn@latest add`。更新现有组件时，先用 `--dry-run` 和 `--diff` 预览变更（参见下方的[更新组件](#updating-components)）。
6. **修复第三方组件中的导入** —— 从社区注册表（如 `@bundui`、`@magicui`）添加组件后，检查添加的非 UI 文件中是否有硬编码的导入路径（如 `@/components/ui/...`）。这些不会匹配项目实际的别名。使用 `npx shadcn@latest info` 获取正确的 `ui` 别名（如 `@workspace/ui/components`）并相应重写导入。CLI 会重写自身 UI 文件的导入，但第三方注册表组件可能使用与项目不匹配的默认路径。
7. **审查添加的组件** —— 从任何注册表添加组件或区块后，**始终阅读添加的文件并验证其正确性**。检查是否缺少子组件（如 `SelectItem` 没有 `SelectGroup`）、缺少导入、错误的组合，或违反[关键规则](#critical-rules)之处。还要根据项目上下文中的 `iconLibrary` 替换任何图标导入（例如注册表项使用 `lucide-react` 但项目使用 `hugeicons`，则相应替换导入和图标名称）。在继续之前修复所有问题。
8. **注册表必须明确** —— 当用户要求添加区块或组件时，**切勿猜测注册表**。如果未指定注册表（如用户说"添加一个登录区块"但未指定 `@shadcn`、`@tailark` 等），询问使用哪个注册表。切勿替用户默认选择注册表。
9. **切换预设** —— 先询问用户：**覆盖**、**部分**、**合并**，还是**跳过**？
   - **检查当前预设**：`npx shadcn@latest preset resolve`。需要结构化值时使用 `--json`。
   - **检查传入预设**：`npx shadcn@latest preset decode <code>`。使用 `preset url <code>` 或 `preset open <code>` 来分享或打开预设构建器。
   - **覆盖**：`npx shadcn@latest apply <code>`。覆盖检测到的组件、字体和 CSS 变量。
   - **部分**：`npx shadcn@latest apply <code> --only theme,font`。仅更新选定的预设部分，不重新安装 UI 组件。支持的值为 `theme` 和 `font`；允许逗号分隔的组合。`icon` 有意不支持，因为图标变更可能需要完整的组件重装和转换。
   - **合并**：`npx shadcn@latest init --preset <code> --force --no-reinstall`，然后运行 `npx shadcn@latest info` 列出已安装组件，再对每个已安装组件使用 `--dry-run` 和 `--diff` 进行[智能合并](#updating-components)。
   - **跳过**：`npx shadcn@latest init --preset <code> --force --no-reinstall`。仅更新配置和 CSS，组件保持不变。
   - **重要**：始终在用户的项目目录内运行预设命令。`apply` 仅在带有 `components.json` 文件的现有项目中有效。CLI 会自动从 `components.json` 保留当前的 base（`base` vs `radix`）。如果必须使用临时/草稿目录（如用于 `--dry-run` 比较），请显式传入 `--base <current-base>` —— 预设代码不编码 base。

## 更新组件

当用户要求从上游更新组件同时保留本地修改时，使用 `--dry-run` 和 `--diff` 进行智能合并。**切勿手动从 GitHub 获取原始文件 —— 始终使用 CLI。**

1. 运行 `npx shadcn@latest add <component> --dry-run` 查看所有会受影响的文件。
2. 对每个文件运行 `npx shadcn@latest add <component> --diff <file>`，查看上游与本地的差异。
3. 根据差异对每个文件决定：
   - 无本地修改 → 可安全覆盖。
   - 有本地修改 → 读取本地文件，分析差异，在保留本地改动的同时应用上游更新。
   - 用户说"全部更新" → 使用 `--overwrite`，但先确认。
4. **未经用户明确同意，切勿使用 `--overwrite`。**

## 快速参考

```bash
# 创建新项目。
npx shadcn@latest init --name my-app --preset base-nova
npx shadcn@latest init --name my-app --preset a2r6bw --template vite

# 创建 monorepo 项目。
npx shadcn@latest init --name my-app --preset base-nova --monorepo
npx shadcn@latest init --name my-app --preset base-nova --template next --monorepo

# 初始化现有项目。
npx shadcn@latest init --preset base-nova
npx shadcn@latest init --defaults  # 简写：--template=next --preset=nova（隐含 base 风格）

# 向现有项目应用预设。
npx shadcn@latest apply a2r6bw
npx shadcn@latest apply a2r6bw --only theme
npx shadcn@latest apply a2r6bw --only font
npx shadcn@latest apply a2r6bw --only theme,font

# 检查预设代码和项目预设状态。
npx shadcn@latest preset decode a2r6bw
npx shadcn@latest preset url a2r6bw
npx shadcn@latest preset open a2r6bw
npx shadcn@latest preset resolve
npx shadcn@latest preset resolve --json

# 添加组件。
npx shadcn@latest add button card dialog
npx shadcn@latest add @magicui/shimmer-button
npx shadcn@latest add --all

# 添加/更新前预览变更。
npx shadcn@latest add button --dry-run
npx shadcn@latest add button --diff button.tsx
npx shadcn@latest add @acme/form --view button.tsx

# 搜索注册表。
npx shadcn@latest search @shadcn -q "sidebar"
npx shadcn@latest search @tailark -q "stats"

# 获取组件文档和示例 URL。
npx shadcn@latest docs button dialog select

# 查看注册表项详情（用于尚未安装的项）。
npx shadcn@latest view @shadcn/button
```

**命名预设：** `nova`、`vega`、`maia`、`lyra`、`mira`、`luma`
**模板：** `next`、`vite`、`start`、`react-router`、`astro`（均支持 `--monorepo`）以及 `laravel`（不支持 monorepo）
**预设代码：** 带版本前缀的 base62 字符串（如 `a2r6bw` 或 `b0`），来自 [ui.shadcn.com](https://ui.shadcn.com)。

## 详细参考

- [rules/forms.md](./rules/forms.md) — FieldGroup、Field、InputGroup、ToggleGroup、FieldSet、校验状态
- [rules/composition.md](./rules/composition.md) — Groups、覆盖层、Card、Tabs、Avatar、Alert、Empty、Toast、Separator、Skeleton、Badge、Button 加载
- [rules/icons.md](./rules/icons.md) — data-icon、图标尺寸、以对象形式传递图标
- [rules/styling.md](./rules/styling.md) — 语义化颜色、变体、className、间距、尺寸、truncate、深色模式、cn()、z-index
- [rules/base-vs-radix.md](./rules/base-vs-radix.md) — asChild vs render、Select、ToggleGroup、Slider、Accordion
- [cli.md](./cli.md) — 命令、标志、预设、模板
- [customization.md](./customization.md) — 主题、CSS 变量、扩展组件
