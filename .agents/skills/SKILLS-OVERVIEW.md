# Skills 功能总览

> 本文档介绍 `.agents/skills/` 目录下 4 个 Skill（技能）各自的功能、使用场景及协作关系。
> 供 AI 助手与人类开发者快速了解每个技能的定位。

---

## 📋 总览

这 4 个 Skill 服务于同一个项目（new-api，一个 AI API 网关）的前端开发，可分为三类：

| Skill | 类型 | 一句话功能 |
|-------|------|-----------|
| classic-to-default-sync | 🔄 迁移工具 | 把旧版前端的功能同步到新版前端 |
| i18n-translate | 🌐 翻译工具 | 维护前端 6 种语言的翻译 |
| shadcn-ui | 🎨 组件规范 | shadcn 组件库的使用规则与项目上下文 |
| vercel-react-best-practices | 📖 参考文档 | React/Next.js 性能优化规则集 |

---

## 1️⃣ classic-to-default-sync —— 前端版本迁移

**🎯 解决什么问题**

这个项目同时维护**两套前端**：

- `web/classic`（经典版）：React 18 + Vite + Semi Design，老版本
- `web/default`（默认版）：React 19 + Rsbuild + Base UI + Tailwind，主力新版本

问题在于：很多功能和 bug 修复是在 classic 上做的，default 可能还没跟上，或者实现质量不行。这个 Skill 就是用来**审计这种差异并补齐**的。

**🛠️ 工作流程**

你给它一个提交 ID（commit hash），它会：

1. 用 `git show <commit-id> -- web/classic` 提取 classic 的改动
2. 在 default 里找对应的文件（注意两套前端组件名、路径都不同，要按**功能**而非文件名匹配）
3. 把每个改动归类成三种状态：
   - ✅ 已存在且实现够好 → 不动
   - ⚠️ 已存在但实现次优 → 改进
   - ❌ 缺失 → 用新版前端的技术栈重新实现
4. 实施后跑 lint、补 i18n、最后汇报一张状态表

> **大白话**：相当于一个"新版前端对账员"，确保新版本不掉队。

---

## 2️⃣ i18n-translate —— 国际化翻译

**🎯 解决什么问题**

前端支持 6 种语言（en、zh、fr、ja、ru、vi），翻译维护很容易出问题：有的 key 用了但没加、有的翻译值跟英文原文一模一样（等于没翻）。

**🛠️ 工作流程**

提供了一套完整的脚本化流程：

1. 跑 `bun run i18n:sync` 拿到同步报告
2. 写临时脚本扫描代码里的 `t('xxx')` 调用，找出**代码用了但语言文件里没有**的 key
3. 再写脚本找出**值等于英文原文**的条目（也就是漏翻的），但会自动跳过品牌名、URL、技术标识符
4. 批量补充翻译，按字母排序写回，最后删掉临时脚本

**🔑 翻译纪律**

- 品牌名（OpenAI、Claude）和模型名（gpt-3.5-turbo）**不翻**
- UI 文字、按钮、错误消息、时间单位**必翻**

> **大白话**：这是前端多语言维护的"质检 + 补漏"工具。

---

## 3️⃣ shadcn-ui —— 组件使用规范

**🎯 解决什么问题**

这个 Skill 最复杂，本质上是给 AI 助手提供**项目感知的 shadcn 组件知识**，让 AI 生成组件代码时不犯错、符合规范。

它分两层结构：

- **外层 SKILL.md**（项目适配层）：告诉 AI 这个项目用的是 `web/default`、Bun、Base UI
- **vendor/shadcn/ 内层文档**（上游规范层）：从 shadcn 官方仓库快照来的深度规则

**📌 核心规则**（这一层最有价值）

内层有几份规则文件，每份都用"错误做法 vs 正确做法"对照：

- **styling.md**（样式）：必须用语义化颜色 `bg-primary`，不能用 `bg-blue-500`；间距用 `gap-*` 不用 `space-y-*`；覆盖层组件不能手动加 `z-index`
- **forms.md**（表单）：必须用 `FieldGroup` + `Field`，不能裸 div；`InputGroup` 里必须用 `InputGroupInput`
- **composition.md**（组合）：`SelectItem` 必须在 `SelectGroup` 内；Dialog/Sheet/Drawer 必须有 Title（可访问性要求）
- **base-vs-radix.md**（关键差异）：Base 用 `render` 属性，Radix 用 `asChild`；Select、Slider、Accordion 在两套库下 API 不同
- **icons.md**（图标）：Button 里的图标要用 `data-icon` 属性，不能手动加尺寸类

**🔑 最特殊的一点**

它有个 `info` 命令会读取项目的 `components.json`，告诉 AI 当前项目用的是 radix 还是 base、哪个 Tailwind 版本、图标库是什么——这样 AI 生成的代码才能匹配实际项目，而不是写一堆用不了的代码。

> **大白话**：这是 shadcn 组件的"使用说明书 + 强制规范"，防止 AI 乱写组件代码。

---

## 4️⃣ vercel-react-best-practices —— 性能优化参考

**🎯 和前 3 个的本质区别**

前 3 个都是**可调用的技能**（带 description 和触发词，能被 AI 主动激活）。而这个是**纯参考文档**（只有一个 AGENTS.md），没有 SKILL.md 入口，它是被其他 Skill 或 AI 阅读、引用的知识库。

**📌 内容结构**

来自 Vercel 工程团队的 React/Next.js 性能指南，8 大类 40+ 条规则，按影响程度排序：

| 级别 | 主题 | 典型规则 |
|------|------|----------|
| 🔴 关键级 | 消除瀑布流 | 延迟 await、`Promise.all()` 并行化、Suspense 边界 |
| 🔴 关键级 | 打包体积 | 避免 barrel 文件导入（能省 200-800ms）、动态导入重型组件 |
| 🟠 高 | 服务端性能 | Server Action 必须像 API 一样鉴权、RSC 边界最小化序列化 |
| 🟡 中 | 重渲染优化 | 渲染期算派生状态、函数式 setState、useRef 存瞬态值 |
| 🟢 低 | JS 性能 | 循环替代排序求最值、用 Map 做 O(1) 查找 |

**🔑 特点**

- 每条规则都配**错误做法 vs 正确做法**的代码对比
- 标注了**具体收益指标**（比如 2-10 倍提升、1M 次操作降到 2K）
- 针对 Next.js 特有的 `after()`、`React.cache()`、RSC 序列化等场景

> **大白话**：这是一本 React 性能优化的"最佳实践手册"，AI 在写 React 代码时会参考它。

---

## 🔗 它们之间的协作关系

这 4 个 Skill 实际上是**配套使用**的。举个工作流的例子：

> 当你在 default 版本加了个新功能（用 **shadcn-ui** 规范写组件）→ 新增了界面文字（用 **i18n-translate** 补 6 种语言翻译）→ 还顺手按 **vercel-react-best-practices** 优化了渲染性能。

而 **classic-to-default-sync** 则是当你发现"这个功能 classic 早就有，default 还没移植"时用的。

这样一看，这 4 个 Skill 基本覆盖了**新版本前端开发的完整闭环**：迁移 → 写组件 → 补翻译 → 性能优化。

---

## 📂 文档索引

| Skill 目录 | 入口文件 |
|-----------|----------|
| `classic-to-default-sync/` | `SKILL.md` |
| `i18n-translate/` | `SKILL.md` |
| `shadcn-ui/` | `SKILL.md`（外层） + `vendor/shadcn/`（内层规范） |
| `vercel-react-best-practices/` | `AGENTS.md` |
