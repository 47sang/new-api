# Base 与 Radix 对比

`base` 和 `radix` 之间的 API 差异。通过 `npx shadcn@latest info` 检查 `base` 字段。

## 目录

- 组合：asChild vs render
- Button/触发器作为非 button 元素
- Select（items 属性、占位符、定位、多选、对象值）
- ToggleGroup（type vs multiple）
- Slider（标量 vs 数组）
- Accordion（type 和 defaultValue）

---

## 组合：asChild（radix）vs render（base）

Radix 使用 `asChild` 替换默认元素。Base 使用 `render`。不要把触发器包裹在额外的元素中。

**错误做法：**

```tsx
<DialogTrigger>
  <div>
    <Button>Open</Button>
  </div>
</DialogTrigger>
```

**正确做法（radix）：**

```tsx
<DialogTrigger asChild>
  <Button>Open</Button>
</DialogTrigger>
```

**正确做法（base）：**

```tsx
<DialogTrigger render={<Button />}>Open</DialogTrigger>
```

这适用于所有触发器和关闭组件：`DialogTrigger`、`SheetTrigger`、`AlertDialogTrigger`、`DropdownMenuTrigger`、`PopoverTrigger`、`TooltipTrigger`、`CollapsibleTrigger`、`DialogClose`、`SheetClose`、`NavigationMenuLink`、`BreadcrumbLink`、`SidebarMenuButton`、`Badge`、`Item`。

---

## Button/触发器作为非 button 元素（仅 base）

当 `render` 将元素改为非 button（`<a>`、`<span>`）时，需要添加 `nativeButton={false}`。

**错误做法（base）：** 缺少 `nativeButton={false}`。

```tsx
<Button render={<a href="/docs" />}>Read the docs</Button>
```

**正确做法（base）：**

```tsx
<Button render={<a href="/docs" />} nativeButton={false}>
  Read the docs
</Button>
```

**正确做法（radix）：**

```tsx
<Button asChild>
  <a href="/docs">Read the docs</a>
</Button>
```

`render` 为非 `Button` 的触发器同理：

```tsx
// base。
<PopoverTrigger render={<InputGroupAddon />} nativeButton={false}>
  Pick date
</PopoverTrigger>
```

---

## Select

**items 属性（仅 base）。** Base 要求在根元素上传入 `items` 属性。Radix 仅使用内联 JSX。

**错误做法（base）：**

```tsx
<Select>
  <SelectTrigger><SelectValue placeholder="Select a fruit" /></SelectTrigger>
</Select>
```

**正确做法（base）：**

```tsx
const items = [
  { label: "Select a fruit", value: null },
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
]

<Select items={items}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      {items.map((item) => (
        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
</Select>
```

**正确做法（radix）：**

```tsx
<Select>
  <SelectTrigger>
    <SelectValue placeholder="Select a fruit" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

**占位符。** Base 在 items 数组中使用 `{ value: null }` 项。Radix 使用 `<SelectValue placeholder="...">`。

**内容定位。** Base 使用 `alignItemWithTrigger`。Radix 使用 `position`。

```tsx
// base。
<SelectContent alignItemWithTrigger={false} side="bottom">

// radix。
<SelectContent position="popper">
```

---

## Select —— 多选和对象值（仅 base）

Base 支持 `multiple`、`SelectValue` 上的渲染函数子组件，以及通过 `itemToStringValue` 处理的对象值。Radix 仅支持单选且仅限字符串值。

**正确做法（base —— 多选）：**

```tsx
<Select items={items} multiple defaultValue={[]}>
  <SelectTrigger>
    <SelectValue>
      {(value: string[]) => value.length === 0 ? "Select fruits" : `${value.length} selected`}
    </SelectValue>
  </SelectTrigger>
  ...
</Select>
```

**正确做法（base —— 对象值）：**

```tsx
<Select defaultValue={plans[0]} itemToStringValue={(plan) => plan.name}>
  <SelectTrigger>
    <SelectValue>{(value) => value.name}</SelectValue>
  </SelectTrigger>
  ...
</Select>
```

---

## ToggleGroup

Base 使用 `multiple` 布尔属性。Radix 使用 `type="single"` 或 `type="multiple"`。

**错误做法（base）：**

```tsx
<ToggleGroup type="single" defaultValue="daily">
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
</ToggleGroup>
```

**正确做法（base）：**

```tsx
// 单选（无需 type 属性），defaultValue 始终是数组。
<ToggleGroup defaultValue={["daily"]} spacing={2}>
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
  <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
</ToggleGroup>

// 多选。
<ToggleGroup multiple>
  <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
  <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
</ToggleGroup>
```

**正确做法（radix）：**

```tsx
// 单选，defaultValue 是字符串。
<ToggleGroup type="single" defaultValue="daily" spacing={2}>
  <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
  <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
</ToggleGroup>

// 多选。
<ToggleGroup type="multiple">
  <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
  <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
</ToggleGroup>
```

**受控的单选值：**

```tsx
// base —— 数组包装/解包。
const [value, setValue] = React.useState("normal")
<ToggleGroup value={[value]} onValueChange={(v) => setValue(v[0])}>

// radix —— 普通字符串。
const [value, setValue] = React.useState("normal")
<ToggleGroup type="single" value={value} onValueChange={setValue}>
```

---

## Slider

Base 对单个滑块接受普通数字。Radix 始终要求数组。

**错误做法（base）：**

```tsx
<Slider defaultValue={[50]} max={100} step={1} />
```

**正确做法（base）：**

```tsx
<Slider defaultValue={50} max={100} step={1} />
```

**正确做法（radix）：**

```tsx
<Slider defaultValue={[50]} max={100} step={1} />
```

范围滑块两者都使用数组。Base 中的受控 `onValueChange` 可能需要类型转换：

```tsx
// base。
const [value, setValue] = React.useState([0.3, 0.7])
<Slider value={value} onValueChange={(v) => setValue(v as number[])} />

// radix。
const [value, setValue] = React.useState([0.3, 0.7])
<Slider value={value} onValueChange={setValue} />
```

---

## Accordion

Radix 要求 `type="single"` 或 `type="multiple"`，并支持 `collapsible`。`defaultValue` 是字符串。Base 不使用 `type` 属性，使用 `multiple` 布尔属性，且 `defaultValue` 始终是数组。

**错误做法（base）：**

```tsx
<Accordion type="single" collapsible defaultValue="item-1">
  <AccordionItem value="item-1">...</AccordionItem>
</Accordion>
```

**正确做法（base）：**

```tsx
<Accordion defaultValue={["item-1"]}>
  <AccordionItem value="item-1">...</AccordionItem>
</Accordion>

// 多选。
<Accordion multiple defaultValue={["item-1", "item-2"]}>
  <AccordionItem value="item-1">...</AccordionItem>
  <AccordionItem value="item-2">...</AccordionItem>
</Accordion>
```

**正确做法（radix）：**

```tsx
<Accordion type="single" collapsible defaultValue="item-1">
  <AccordionItem value="item-1">...</AccordionItem>
</Accordion>
```
