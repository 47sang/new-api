---
name: classic-to-default-sync
description: 检查指定提交中 web/classic 的变更，并将所有功能/修复同步到 web/default。当用户提供提交 ID 并希望审计 web/default 是否已具备与 web/classic 相同的功能、移植缺失功能、改进次优实现、修复错误以及删除冗余代码时使用。触发短语包括："classic-to-default-sync <hash>"、"/classic-to-default-sync <hash>"、"sync classic to default"、"port from classic"、"compare classic commit"、"classic 和 default 对比"、"把这次 classic 的修改同步到 default"、"查看这次提交 classic 中的修改并同步"，或任何提供提交哈希并附带 classic/default 对比意图的请求。
---

# Classic-to-Default Sync（经典版同步至默认版）

给定一个 **提交 ID**，审计所有 `web/classic` 的变更，并确保 `web/default` 以尽可能最优的实现达到功能对等。

## 输入

用户必须提供一个 `<commit-id>`。

## 工作流程

### 第一步 — 提取 classic 的 diff

```bash
git show <commit-id> -- web/classic
```

通读 `web/classic` 中所有变更的文件。识别**逻辑变更**（新功能、界面/体验改进、错误修复、配置调整、已删除的冗余代码等），而不仅仅是行级别的差异。

### 第二步 — 映射到 default 的对应文件

对于第一步中发现的每一个逻辑变更，在 `web/default/src/` 中定位对应的文件。根据需要灵活使用全局搜索、正则搜索或语义搜索。注意：

- `web/classic` 使用 **React 18 + Vite + Semi Design**
- `web/default` 使用 **React 19 + Rsbuild + Base UI + Tailwind CSS**
- 组件名称、文件路径和 API 形态可能不同；按**功能**匹配，而非按文件名匹配。

### 第三步 — 分类每个变更

将每个逻辑变更归入以下类别之一：

| 状态 | 含义 |
|------|------|
| ✅ 已存在且实现最优 | 无需操作 |
| ⚠️ 已存在但实现次优 | 改进：逻辑、布局、样式或代码质量 |
| ❌ 缺失 | 在 default 的栈中从零实现 |

### 第四步 — 实施

对于每个 ⚠️ 或 ❌ 项：

1. 编辑前**先读取 `web/default` 中的目标文件**（项目约定要求）。
2. 遵循 `web/default` 的约定实现：
   - React 19 模式（hooks、Suspense 等）
   - 尽可能使用 Base UI 基础组件
   - 使用 Tailwind CSS 编写样式（不使用内联样式或 Semi Design 导入）
   - 所有面向用户的字符串使用 `useTranslation()` + `t('英文键名')`
   - TypeScript — 显式类型，不使用 `any`
   - 无冗余代码，无多余注释
3. 如果涉及 relay 相关的 TypeScript 类型，遵循 **规则 6**（可选 relay DTO 使用指针类型）。
4. 编辑完成后，对变更的文件运行 `ReadLints` 并修复引入的 lint 错误。

### 第五步 — 国际化

如果添加了任何新的面向用户的字符串，运行国际化同步：

```bash
cd web/default && bun run i18n:sync
```

然后按照 **i18n-translate** 技能，为所有支持的语言（en、zh、fr、ja、ru、vi）补充缺失的翻译。

### 第六步 — 报告

以简洁的表格总结工作：

| # | 变更（来自 classic 提交） | 状态 | 采取的操作 |
|---|--------------------------|------|------------|
| 1 | … | ✅ / ⚠️ / ❌ | 无 / 已改进 / 已实现 |

如果所有项均为 ✅ 且无需操作，直接回复：**"已完成 — web/default 已具备此次提交的所有功能，且实现质量良好，无需修改。"**

## 质量标准

- 无未使用的导入、变量或组件
- 无遗留的被注释掉的代码
- 命名与周围 `web/default` 代码保持一致
- 所有交互元素可访问（键盘导航、Radix 未自动提供的 ARIA 标签）
- 无回归：`web/default` 中的现有行为不得被破坏
