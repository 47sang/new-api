# 样式与自定义

主题、CSS 变量和添加自定义颜色参见 [customization.md](../customization.md)。

## 目录

- 语义化颜色
- 优先使用内置变体
- className 仅用于布局
- 不使用 space-x-* / space-y-*
- 宽高相等时优先使用 size-* 而非 w-* h-*
- 优先使用 truncate 简写
- 不手动覆盖 dark: 颜色
- 使用 cn() 处理条件类
- 覆盖层组件不手动设置 z-index

---

## 语义化颜色

**错误做法：**

```tsx
<div className="bg-blue-500 text-white">
  <p className="text-gray-600">Secondary text</p>
</div>
```

**正确做法：**

```tsx
<div className="bg-primary text-primary-foreground">
  <p className="text-muted-foreground">Secondary text</p>
</div>
```

---

## 状态/状态指示器不使用原始颜色值

对于正面、负面或状态指示，使用 Badge 变体、`text-destructive` 等语义化令牌，或定义自定义 CSS 变量 —— 不要直接使用原始 Tailwind 颜色。

**错误做法：**

```tsx
<span className="text-emerald-600">+20.1%</span>
<span className="text-green-500">Active</span>
<span className="text-red-600">-3.2%</span>
```

**正确做法：**

```tsx
<Badge variant="secondary">+20.1%</Badge>
<Badge>Active</Badge>
<span className="text-destructive">-3.2%</span>
```

如果你需要一个语义化令牌中不存在的成功/正面颜色，使用 Badge 变体，或询问用户是否在主题中添加自定义 CSS 变量（参见 [customization.md](../customization.md)）。

---

## 优先使用内置变体

**错误做法：**

```tsx
<Button className="border border-input bg-transparent hover:bg-accent">
  Click me
</Button>
```

**正确做法：**

```tsx
<Button variant="outline">Click me</Button>
```

---

## className 仅用于布局

`className` 用于布局（例如 `max-w-md`、`mx-auto`、`mt-4`），**不要**用于覆盖组件的颜色或排版。要修改颜色，请使用语义化令牌、内置变体或 CSS 变量。

**错误做法：**

```tsx
<Card className="bg-blue-100 text-blue-900 font-bold">
  <CardContent>Dashboard</CardContent>
</Card>
```

**正确做法：**

```tsx
<Card className="max-w-md mx-auto">
  <CardContent>Dashboard</CardContent>
</Card>
```

自定义组件外观时，按以下顺序优先使用：
1. **内置变体** — `variant="outline"`、`variant="destructive"` 等
2. **语义化颜色令牌** — `bg-primary`、`text-muted-foreground`
3. **CSS 变量** — 在全局 CSS 文件中定义自定义颜色（参见 [customization.md](../customization.md)）

---

## 不使用 space-x-* / space-y-*

改用 `gap-*`。`space-y-4` → `flex flex-col gap-4`。`space-x-2` → `flex gap-2`。

```tsx
<div className="flex flex-col gap-4">
  <Input />
  <Input />
  <Button>Submit</Button>
</div>
```

---

## 宽高相等时优先使用 size-* 而非 w-* h-*

使用 `size-10` 而非 `w-10 h-10`。适用于图标、头像、骨架屏等。

---

## 优先使用 truncate 简写

使用 `truncate` 而非 `overflow-hidden text-ellipsis whitespace-nowrap`。

---

## 不手动覆盖 dark: 颜色

使用语义化令牌 —— 它们通过 CSS 变量自动处理浅色/深色。使用 `bg-background text-foreground` 而非 `bg-white dark:bg-gray-950`。

---

## 使用 cn() 处理条件类

使用项目中的 `cn()` 工具处理条件或合并的类名。不要在 className 字符串中手写三元表达式。

**错误做法：**

```tsx
<div className={`flex items-center ${isActive ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
```

**正确做法：**

```tsx
import { cn } from "@/lib/utils"

<div className={cn("flex items-center", isActive ? "bg-primary text-primary-foreground" : "bg-muted")}>
```

---

## 覆盖层组件不手动设置 z-index

`Dialog`、`Sheet`、`Drawer`、`AlertDialog`、`DropdownMenu`、`Popover`、`Tooltip`、`HoverCard` 自行处理层叠顺序。切勿添加 `z-50` 或 `z-[999]`。
