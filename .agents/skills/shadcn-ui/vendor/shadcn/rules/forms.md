# 表单与输入控件

## 目录

- 表单使用 FieldGroup + Field
- InputGroup 需要 InputGroupInput/InputGroupTextarea
- 输入框内的按钮使用 InputGroup + InputGroupAddon
- 选项组（2–7 个选项）使用 ToggleGroup
- 使用 FieldSet + FieldLegend 分组相关字段
- 字段校验与禁用状态

---

## 表单使用 FieldGroup + Field

始终使用 `FieldGroup` + `Field` —— 永远不要使用带 `space-y-*` 的原始 `div`：

```tsx
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input id="email" type="email" />
  </Field>
  <Field>
    <FieldLabel htmlFor="password">Password</FieldLabel>
    <Input id="password" type="password" />
  </Field>
</FieldGroup>
```

设置页面使用 `Field orientation="horizontal"`。视觉上隐藏的标签使用 `FieldLabel className="sr-only"`。

**选择表单控件：**

- 简单文本输入 → `Input`
- 预定义选项的下拉 → `Select`
- 可搜索的下拉 → `Combobox`
- 原生 HTML select（无 JS）→ `native-select`
- 布尔值开关 → `Switch`（用于设置）或 `Checkbox`（用于表单）
- 少量选项中单选 → `RadioGroup`
- 在 2–5 个选项间切换 → `ToggleGroup` + `ToggleGroupItem`
- OTP/验证码 → `InputOTP`
- 多行文本 → `Textarea`

---

## InputGroup 需要 InputGroupInput/InputGroupTextarea

切勿在 `InputGroup` 内使用原始的 `Input` 或 `Textarea`。

**错误做法：**

```tsx
<InputGroup>
  <Input placeholder="Search..." />
</InputGroup>
```

**正确做法：**

```tsx
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"

<InputGroup>
  <InputGroupInput placeholder="Search..." />
</InputGroup>
```

---

## 输入框内的按钮使用 InputGroup + InputGroupAddon

切勿将 `Button` 直接放在 `Input` 内部或旁边并使用自定义定位。

**错误做法：**

```tsx
<div className="relative">
  <Input placeholder="Search..." className="pr-10" />
  <Button className="absolute right-0 top-0" size="icon">
    <SearchIcon />
  </Button>
</div>
```

**正确做法：**

```tsx
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"

<InputGroup>
  <InputGroupInput placeholder="Search..." />
  <InputGroupAddon>
    <Button size="icon">
      <SearchIcon data-icon="inline-start" />
    </Button>
  </InputGroupAddon>
</InputGroup>
```

---

## 选项组（2–7 个选项）使用 ToggleGroup

不要手动循环 `Button` 组件并维护激活状态。

**错误做法：**

```tsx
const [selected, setSelected] = useState("daily")

<div className="flex gap-2">
  {["daily", "weekly", "monthly"].map((option) => (
    <Button
      key={option}
      variant={selected === option ? "default" : "outline"}
      onClick={() => setSelected(option)}
    >
      {option}
    </Button>
  ))}
</div>
```

**正确做法：**

```tsx
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

<ToggleGroup spacing={2}>
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
  <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
  <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
</ToggleGroup>
```

与 `Field` 组合用于带标签的切换组：

```tsx
<Field orientation="horizontal">
  <FieldTitle id="theme-label">Theme</FieldTitle>
  <ToggleGroup aria-labelledby="theme-label" spacing={2}>
    <ToggleGroupItem value="light">Light</ToggleGroupItem>
    <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    <ToggleGroupItem value="system">System</ToggleGroupItem>
  </ToggleGroup>
</Field>
```

> **注意：** `defaultValue` 和 `type`/`multiple` 属性在 base 和 radix 之间有所不同。参见 [base-vs-radix.md](./base-vs-radix.md#togglegroup)。

---

## 使用 FieldSet + FieldLegend 分组相关字段

对相关的复选框、单选框或开关使用 `FieldSet` + `FieldLegend` —— 而非带标题的 `div`：

```tsx
<FieldSet>
  <FieldLegend variant="label">Preferences</FieldLegend>
  <FieldDescription>Select all that apply.</FieldDescription>
  <FieldGroup className="gap-3">
    <Field orientation="horizontal">
      <Checkbox id="dark" />
      <FieldLabel htmlFor="dark" className="font-normal">Dark mode</FieldLabel>
    </Field>
  </FieldGroup>
</FieldSet>
```

---

## 字段校验与禁用状态

这两个属性都需要 —— `data-invalid`/`data-disabled` 用于为字段设置样式（标签、描述），而 `aria-invalid`/`disabled` 用于为控件设置样式。

```tsx
// 无效。
<Field data-invalid>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" aria-invalid />
  <FieldDescription>Invalid email address.</FieldDescription>
</Field>

// 禁用。
<Field data-disabled>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" disabled />
</Field>
```

适用于所有控件：`Input`、`Textarea`、`Select`、`Checkbox`、`RadioGroupItem`、`Switch`、`Slider`、`NativeSelect`、`InputOTP`。
