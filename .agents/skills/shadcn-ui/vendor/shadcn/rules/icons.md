# 图标

**始终使用项目配置的 `iconLibrary` 进行导入。** 通过项目上下文检查 `iconLibrary` 字段：`lucide` → `lucide-react`，`tabler` → `@tabler/icons-react` 等。切勿假设为 `lucide-react`。

---

## Button 内的图标使用 data-icon 属性

为图标添加 `data-icon="inline-start"`（前缀）或 `data-icon="inline-end"`（后缀）。图标上不要加尺寸类。

**错误做法：**

```tsx
<Button>
  <SearchIcon className="mr-2 size-4" />
  Search
</Button>
```

**正确做法：**

```tsx
<Button>
  <SearchIcon data-icon="inline-start"/>
  Search
</Button>

<Button>
  Next
  <ArrowRightIcon data-icon="inline-end"/>
</Button>
```

---

## 组件内的图标不加尺寸类

组件通过 CSS 处理图标尺寸。不要给 `Button`、`DropdownMenuItem`、`Alert`、`Sidebar*` 或其他 shadcn 组件内的图标添加 `size-4`、`w-4 h-4` 或其他尺寸类。除非用户明确要求自定义图标尺寸。

**错误做法：**

```tsx
<Button>
  <SearchIcon className="size-4" data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon className="mr-2 size-4" />
  Settings
</DropdownMenuItem>
```

**正确做法：**

```tsx
<Button>
  <SearchIcon data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon />
  Settings
</DropdownMenuItem>
```

---

## 以组件对象形式传递图标，而非字符串键

使用 `icon={CheckIcon}`，而非通过字符串键查找映射表。

**错误做法：**

```tsx
const iconMap = {
  check: CheckIcon,
  alert: AlertIcon,
}

function StatusBadge({ icon }: { icon: string }) {
  const Icon = iconMap[icon]
  return <Icon />
}

<StatusBadge icon="check" />
```

**正确做法：**

```tsx
// 从项目配置的 iconLibrary 导入（如 lucide-react、@tabler/icons-react）。
import { CheckIcon } from "lucide-react"

function StatusBadge({ icon: Icon }: { icon: React.ComponentType }) {
  return <Icon />
}

<StatusBadge icon={CheckIcon} />
```
