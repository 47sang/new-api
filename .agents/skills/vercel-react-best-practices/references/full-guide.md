# React 最佳实践

**版本 1.0.0**
Vercel 工程团队
2026 年 1 月

> **说明：**
> 本文档主要面向代理和 LLM，用于在维护、生成或重构 React 和 Next.js 代码库时遵循。
> 人类开发者也可以从中获益，但本文档的指导原则针对 AI 辅助工作流进行了优化，
> 以确保自动化和一致性。

---

## 摘要

面向 React 和 Next.js 应用的全面性能优化指南，专为 AI 代理和 LLM 设计。
包含 8 大类、40 多条规则，按影响程度从高到低排列（从关键级的消除瀑布流、减少打包体积，到增量级的进阶模式）。
每条规则包含详细解释、错误与正确实现的对比示例，以及具体的影响指标，用于指导自动化重构和代码生成。

---

## 目录

1. [消除瀑布流](#1-消除瀑布流) — **关键级**
   - 1.1 [延迟 await 到需要时才执行](#11-延迟-await-到需要时才执行)
   - 1.2 [基于依赖的并行化](#12-基于依赖的并行化)
   - 1.3 [防止 API 路由中的瀑布流链](#13-防止-api-路由中的瀑布流链)
   - 1.4 [独立操作使用 Promise.all()](#14-独立操作使用-promiseall)
   - 1.5 [策略性的 Suspense 边界](#15-策略性的-suspense-边界)
2. [打包体积优化](#2-打包体积优化) — **关键级**
   - 2.1 [避免 barrel 文件导入](#21-避免-barrel-文件导入)
   - 2.2 [条件模块加载](#22-条件模块加载)
   - 2.3 [延迟非关键的第三方库](#23-延迟非关键的第三方库)
   - 2.4 [重型组件使用动态导入](#24-重型组件使用动态导入)
   - 2.5 [基于用户意图的预加载](#25-基于用户意图的预加载)
3. [服务端性能](#3-服务端性能) — **高**
   - 3.1 [像 API 路由一样验证服务端操作](#31-像-api-路由一样验证服务端操作)
   - 3.2 [避免 RSC 属性中的重复序列化](#32-避免-rsc-属性中的重复序列化)
   - 3.3 [跨请求 LRU 缓存](#33-跨请求-lru-缓存)
   - 3.4 [最小化 RSC 边界处的序列化](#34-最小化-rsc-边界处的序列化)
   - 3.5 [通过组件组合并行获取数据](#35-通过组件组合并行获取数据)
   - 3.6 [使用 React.cache() 做请求级去重](#36-使用-reactcache-做请求级去重)
   - 3.7 [使用 after() 执行非阻塞操作](#37-使用-after-执行非阻塞操作)
4. [客户端数据获取](#4-客户端数据获取) — **中高**
   - 4.1 [全局事件监听器去重](#41-全局事件监听器去重)
   - 4.2 [滚动性能使用被动事件监听器](#42-滚动性能使用被动事件监听器)
   - 4.3 [使用 SWR 自动去重](#43-使用-swr-自动去重)
   - 4.4 [版本化并最小化 localStorage 数据](#44-版本化并最小化-localstorage-数据)
5. [重渲染优化](#5-重渲染优化) — **中**
   - 5.1 [在渲染过程中计算派生状态](#51-在渲染过程中计算派生状态)
   - 5.2 [状态读取延迟到使用点](#52-状态读取延迟到使用点)
   - 5.3 [不要对原始结果类型的简单表达式使用 useMemo 包装](#53-不要对原始结果类型的简单表达式使用-usememo-包装)
   - 5.4 [将 memoized 组件的默认非原始参数值提取为常量](#54-将-memoized-组件的默认非原始参数值提取为常量)
   - 5.5 [提取为 memoized 组件](#55-提取为-memoized-组件)
   - 5.6 [缩小 effect 的依赖范围](#56-缩小-effect-的依赖范围)
   - 5.7 [交互逻辑放在事件处理器中](#57-交互逻辑放在事件处理器中)
   - 5.8 [订阅派生状态](#58-订阅派生状态)
   - 5.9 [使用函数式 setState 更新](#59-使用函数式-setstate-更新)
   - 5.10 [使用惰性状态初始化](#510-使用惰性状态初始化)
   - 5.11 [使用 Transitions 处理非紧急更新](#511-使用-transitions-处理非紧急更新)
   - 5.12 [对瞬态值使用 useRef](#512-对瞬态值使用-useref)
6. [渲染性能](#6-渲染性能) — **中**
   - 6.1 [动画 SVG 的包裹元素而非 SVG 本身](#61-动画-svg-的包裹元素而非-svg-本身)
   - 6.2 [长列表使用 CSS content-visibility](#62-长列表使用-css-content-visibility)
   - 6.3 [提升静态 JSX 元素](#63-提升静态-jsx-元素)
   - 6.4 [优化 SVG 精度](#64-优化-svg-精度)
   - 6.5 [无闪烁地防止水合不匹配](#65-无闪烁地防止水合不匹配)
   - 6.6 [抑制预期的水合不匹配](#66-抑制预期的水合不匹配)
   - 6.7 [使用 Activity 组件控制显隐](#67-使用-activity-组件控制显隐)
   - 6.8 [使用显式条件渲染](#68-使用显式条件渲染)
   - 6.9 [使用 useTransition 而非手动加载状态](#69-使用-usetransition-而非手动加载状态)
7. [JavaScript 性能](#7-javascript-性能) — **低中**
   - 7.1 [避免布局抖动](#71-避免布局抖动)
   - 7.2 [为重复查找构建索引映射](#72-为重复查找构建索引映射)
   - 7.3 [循环中缓存属性访问](#73-循环中缓存属性访问)
   - 7.4 [缓存重复的函数调用](#74-缓存重复的函数调用)
   - 7.5 [缓存存储 API 调用](#75-缓存存储-api-调用)
   - 7.6 [合并多次数组迭代](#76-合并多次数组迭代)
   - 7.7 [数组比较前先检查长度](#77-数组比较前先检查长度)
   - 7.8 [函数中尽早返回](#78-函数中尽早返回)
   - 7.9 [提升 RegExp 创建](#79-提升-regexp-创建)
   - 7.10 [求最值用循环而非排序](#710-求最值用循环而非排序)
   - 7.11 [使用 Set/Map 实现 O(1) 查找](#711-使用-setmap-实现-o1-查找)
   - 7.12 [为不可变性使用 toSorted() 而非 sort()](#712-为不可变性使用-tosorted-而非-sort)
8. [高级模式](#8-高级模式) — **低**
   - 8.1 [只初始化一次应用，不要每次挂载都初始化](#81-只初始化一次应用不要每次挂载都初始化)
   - 8.2 [事件处理器存储在 ref 中](#82-事件处理器存储在-ref-中)
   - 8.3 [useEffectEvent 用于稳定的回调引用](#83-useeffectevent-用于稳定的回调引用)

---

## 1. 消除瀑布流

**影响程度：关键级**

瀑布流是头号性能杀手。每个顺序 await 会增加完整的网络延迟。消除它们可以获得最大的收益。

### 1.1 延迟 await 到需要时才执行

**影响程度：高（避免阻塞未使用的代码路径）**

将 `await` 操作移到实际使用它的分支中，以避免阻塞不需要它们的代码路径。

**错误做法：阻塞了两个分支**

```typescript
async function handleRequest(userId: string, skipProcessing: boolean) {
  const userData = await fetchUserData(userId)

  if (skipProcessing) {
    // 立即返回，但仍然等待了 userData
    return { skipped: true }
  }

  // 只有这个分支使用 userData
  return processUserData(userData)
}
```

**正确做法：仅在需要时阻塞**

```typescript
async function handleRequest(userId: string, skipProcessing: boolean) {
  if (skipProcessing) {
    // 立即返回，无需等待
    return { skipped: true }
  }

  // 仅在需要时获取
  const userData = await fetchUserData(userId)
  return processUserData(userData)
}
```

**另一个示例：提前返回优化**

```typescript
// 错误做法：总是获取权限
async function updateResource(resourceId: string, userId: string) {
  const permissions = await fetchPermissions(userId)
  const resource = await getResource(resourceId)

  if (!resource) {
    return { error: 'Not found' }
  }

  if (!permissions.canEdit) {
    return { error: 'Forbidden' }
  }

  return await updateResourceData(resource, permissions)
}

// 正确做法：仅在需要时获取
async function updateResource(resourceId: string, userId: string) {
  const resource = await getResource(resourceId)

  if (!resource) {
    return { error: 'Not found' }
  }

  const permissions = await fetchPermissions(userId)

  if (!permissions.canEdit) {
    return { error: 'Forbidden' }
  }

  return await updateResourceData(resource, permissions)
}
```

当跳过的分支经常被命中，或被延迟的操作开销较大时，此优化特别有价值。

### 1.2 基于依赖的并行化

**影响程度：关键级（2-10 倍提升）**

对于有部分依赖关系的操作，使用 `better-all` 最大化并行度。它会自动在每个任务可能的最早时刻启动。

**错误做法：profile 不必要地等待 config**

```typescript
const [user, config] = await Promise.all([
  fetchUser(),
  fetchConfig()
])
const profile = await fetchProfile(user.id)
```

**正确做法：config 和 profile 并行执行**

```typescript
import { all } from 'better-all'

const { user, config, profile } = await all({
  async user() { return fetchUser() },
  async config() { return fetchConfig() },
  async profile() {
    return fetchProfile((await this.$.user).id)
  }
})
```

**无额外依赖的替代方案：**

```typescript
const userPromise = fetchUser()
const profilePromise = userPromise.then(user => fetchProfile(user.id))

const [user, config, profile] = await Promise.all([
  userPromise,
  fetchConfig(),
  profilePromise
])
```

也可以先创建所有 Promise，最后统一 `Promise.all()`。

参考：[https://github.com/shuding/better-all](https://github.com/shuding/better-all)

### 1.3 防止 API 路由中的瀑布流链

**影响程度：关键级（2-10 倍提升）**

在 API 路由和 Server Actions 中，立即启动独立操作，即使你还没有 await 它们。

**错误做法：config 等待 auth，data 等待两者**

```typescript
export async function GET(request: Request) {
  const session = await auth()
  const config = await fetchConfig()
  const data = await fetchData(session.user.id)
  return Response.json({ data, config })
}
```

**正确做法：auth 和 config 立即启动**

```typescript
export async function GET(request: Request) {
  const sessionPromise = auth()
  const configPromise = fetchConfig()
  const session = await sessionPromise
  const [config, data] = await Promise.all([
    configPromise,
    fetchData(session.user.id)
  ])
  return Response.json({ data, config })
}
```

对于更复杂的依赖链，使用 `better-all` 自动最大化并行度（参见基于依赖的并行化）。

### 1.4 独立操作使用 Promise.all()

**影响程度：关键级（2-10 倍提升）**

当异步操作之间没有依赖关系时，使用 `Promise.all()` 并发执行它们。

**错误做法：顺序执行，3 次往返**

```typescript
const user = await fetchUser()
const posts = await fetchPosts()
const comments = await fetchComments()
```

**正确做法：并行执行，1 次往返**

```typescript
const [user, posts, comments] = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments()
])
```

### 1.5 策略性的 Suspense 边界

**影响程度：高（更快的初始绘制）**

不要在异步组件中先 await 数据再返回 JSX，而是使用 Suspense 边界在数据加载时先显示外层 UI。

**错误做法：外层被数据获取阻塞**

```tsx
async function Page() {
  const data = await fetchData() // 阻塞整个页面

  return (
    <div>
      <div>Sidebar</div>
      <div>Header</div>
      <div>
        <DataDisplay data={data} />
      </div>
      <div>Footer</div>
    </div>
  )
}
```

整个布局都在等待数据，尽管只有中间部分需要它。

**正确做法：外层立即显示，数据逐步流入**

```tsx
function Page() {
  return (
    <div>
      <div>Sidebar</div>
      <div>Header</div>
      <div>
        <Suspense fallback={<Skeleton />}>
          <DataDisplay />
        </Suspense>
      </div>
      <div>Footer</div>
    </div>
  )
}

async function DataDisplay() {
  const data = await fetchData() // 仅阻塞此组件
  return <div>{data.content}</div>
}
```

Sidebar、Header 和 Footer 立即渲染。只有 DataDisplay 等待数据。

**替代方案：跨组件共享 Promise**

```tsx
function Page() {
  // 立即开始获取，但先不 await
  const dataPromise = fetchData()

  return (
    <div>
      <div>Sidebar</div>
      <div>Header</div>
      <Suspense fallback={<Skeleton />}>
        <DataDisplay dataPromise={dataPromise} />
        <DataSummary dataPromise={dataPromise} />
      </Suspense>
      <div>Footer</div>
    </div>
  )
}

function DataDisplay({ dataPromise }: { dataPromise: Promise<Data> }) {
  const data = use(dataPromise) // 解包 Promise
  return <div>{data.content}</div>
}

function DataSummary({ dataPromise }: { dataPromise: Promise<Data> }) {
  const data = use(dataPromise) // 复用同一个 Promise
  return <div>{data.summary}</div>
}
```

两个组件共享同一个 Promise，因此只会发生一次获取。布局立即渲染，而两个组件一起等待。

**不适用的场景：**

- 影响布局决策的关键数据（影响定位）
- 首屏对 SEO 关键的内容
- 小而快的查询，suspense 开销不划算
- 想要避免布局偏移（加载后内容跳动）

**权衡：** 更快的初始绘制 vs 潜在的布局偏移。根据你的用户体验优先级选择。

---

## 2. 打包体积优化

**影响程度：关键级**

减少初始打包体积可改善可交互时间（TTI）和最大内容绘制（LCP）。

### 2.1 避免 barrel 文件导入

**影响程度：关键级（导入开销 200-800ms，构建缓慢）**

直接从源文件导入，避免加载 barrel 文件中数千个未使用的模块。**Barrel 文件**是指重新导出多个模块的入口文件（例如 `index.js` 中做 `export * from './module'`）。

流行的图标和组件库在其入口文件中可以有 **多达 10,000 个导出**。对于许多 React 包来说，**仅导入就要花费 200-800ms**，影响开发速度和线上冷启动。

**为什么 Tree Shaking 没用：** 当库被标记为外部依赖（不打包）时，打包器无法优化它。如果将其打包以启用 tree shaking，构建速度会大幅下降，因为打包器需要分析整个模块图。

**错误做法：导入整个库**

```tsx
import { Check, X, Menu } from 'lucide-react'
// 加载 1,583 个模块，开发环境多花 ~2.8 秒
// 运行时开销：每次冷启动 200-800ms

import { Button, TextField } from '@mui/material'
// 加载 2,225 个模块，开发环境多花 ~4.2 秒
```

**正确做法：只导入需要的部分**

```tsx
import Check from 'lucide-react/dist/esm/icons/check'
import X from 'lucide-react/dist/esm/icons/x'
import Menu from 'lucide-react/dist/esm/icons/menu'
// 仅加载 3 个模块（约 2KB vs 约 1MB）

import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
// 只加载你使用的部分
```

**替代方案：Next.js 13.5+**

```js
// next.config.js - 使用 optimizePackageImports
module.exports = {
  experimental: {
    optimizePackageImports: ['lucide-react', '@mui/material']
  }
}

// 然后你可以保持便捷的 barrel 导入：
import { Check, X, Menu } from 'lucide-react'
// 构建时自动转换为直接导入
```

直接导入可带来开发启动快 15-70%、构建快 28%、冷启动快 40%，以及显著更快的 HMR。

常见受影响的库：`lucide-react`、`@mui/material`、`@mui/icons-material`、`@tabler/icons-react`、`react-icons`、`@headlessui/react`、`@radix-ui/react-*`、`lodash`、`ramda`、`date-fns`、`rxjs`、`react-use`。

参考：[https://vercel.com/blog/how-we-optimized-package-imports-in-next-js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)

### 2.2 条件模块加载

**影响程度：高（仅在需要时加载大体积数据）**

仅在功能被激活时加载大型数据或模块。

**示例：惰性加载动画帧**

```tsx
function AnimationPlayer({ enabled, setEnabled }: { enabled: boolean; setEnabled: React.Dispatch<React.SetStateAction<boolean>> }) {
  const [frames, setFrames] = useState<Frame[] | null>(null)

  useEffect(() => {
    if (enabled && !frames && typeof window !== 'undefined') {
      import('./animation-frames.js')
        .then(mod => setFrames(mod.frames))
        .catch(() => setEnabled(false))
    }
  }, [enabled, frames, setEnabled])

  if (!frames) return <Skeleton />
  return <Canvas frames={frames} />
}
```

`typeof window !== 'undefined'` 检查可防止该模块被 SSR 打包，从而优化服务端打包体积和构建速度。

### 2.3 延迟非关键的第三方库

**影响程度：中（在 hydration 之后加载）**

分析、日志记录和错误跟踪不会阻塞用户交互。在 hydration 之后加载它们。

**错误做法：阻塞初始打包**

```tsx
import { Analytics } from '@vercel/analytics/react'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
```

**正确做法：hydration 后加载**

```tsx
import dynamic from 'next/dynamic'

const Analytics = dynamic(
  () => import('@vercel/analytics/react').then(m => m.Analytics),
  { ssr: false }
)

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
```

### 2.4 重型组件使用动态导入

**影响程度：关键级（直接影响 TTI 和 LCP）**

使用 `next/dynamic` 对初始渲染不需要的大型组件进行惰性加载。

**错误做法：Monaco 随主包一起打包，约 300KB**

```tsx
import { MonacoEditor } from './monaco-editor'

function CodePanel({ code }: { code: string }) {
  return <MonacoEditor value={code} />
}
```

**正确做法：Monaco 按需加载**

```tsx
import dynamic from 'next/dynamic'

const MonacoEditor = dynamic(
  () => import('./monaco-editor').then(m => m.MonacoEditor),
  { ssr: false }
)

function CodePanel({ code }: { code: string }) {
  return <MonacoEditor value={code} />
}
```

### 2.5 基于用户意图的预加载

**影响程度：中（降低感知延迟）**

在需要重型包之前预加载它们，以降低感知延迟。

**示例：悬停/聚焦时预加载**

```tsx
function EditorButton({ onClick }: { onClick: () => void }) {
  const preload = () => {
    if (typeof window !== 'undefined') {
      void import('./monaco-editor')
    }
  }

  return (
    <button
      onMouseEnter={preload}
      onFocus={preload}
      onClick={onClick}
    >
      Open Editor
    </button>
  )
}
```

**示例：功能标志启用时预加载**

```tsx
function FlagsProvider({ children, flags }: Props) {
  useEffect(() => {
    if (flags.editorEnabled && typeof window !== 'undefined') {
      void import('./monaco-editor').then(mod => mod.init())
    }
  }, [flags.editorEnabled])

  return <FlagsContext.Provider value={flags}>
    {children}
  </FlagsContext.Provider>
}
```

`typeof window !== 'undefined'` 检查可防止预加载模块被 SSR 打包，从而优化服务端打包体积和构建速度。

---

## 3. 服务端性能

**影响程度：高**

优化服务端渲染和数据获取可消除服务端瀑布流并缩短响应时间。

### 3.1 像 API 路由一样验证服务端操作

**影响程度：关键级（防止对服务端变更的未授权访问）**

服务端操作（带 `"use server"` 的函数）是公开端点，与 API 路由类似。始终在每个服务端操作**内部**验证认证和授权——不要仅依赖中间件、布局守卫或页面级检查，因为服务端操作可以被直接调用。

Next.js 文档明确指出："将服务端操作视为面向公众的 API 端点，并验证用户是否有权执行该变更。"

**错误做法：无认证检查**

```typescript
'use server'

export async function deleteUser(userId: string) {
  // 任何人都可以调用！无认证检查
  await db.user.delete({ where: { id: userId } })
  return { success: true }
}
```

**正确做法：在操作内部进行认证**

```typescript
'use server'

import { verifySession } from '@/lib/auth'
import { unauthorized } from '@/lib/errors'

export async function deleteUser(userId: string) {
  // 始终在操作内部检查认证
  const session = await verifySession()

  if (!session) {
    throw unauthorized('Must be logged in')
  }

  // 也检查授权
  if (session.user.role !== 'admin' && session.user.id !== userId) {
    throw unauthorized('Cannot delete other users')
  }

  await db.user.delete({ where: { id: userId } })
  return { success: true }
}
```

**带输入验证的示例：**

```typescript
'use server'

import { verifySession } from '@/lib/auth'
import { z } from 'zod'

const updateProfileSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email()
})

export async function updateProfile(data: unknown) {
  // 首先验证输入
  const validated = updateProfileSchema.parse(data)

  // 然后认证
  const session = await verifySession()
  if (!session) {
    throw new Error('Unauthorized')
  }

  // 然后授权
  if (session.user.id !== validated.userId) {
    throw new Error('Can only update own profile')
  }

  // 最后执行变更
  await db.user.update({
    where: { id: validated.userId },
    data: {
      name: validated.name,
      email: validated.email
    }
  })

  return { success: true }
}
```

参考：[https://nextjs.org/docs/app/guides/authentication](https://nextjs.org/docs/app/guides/authentication)

### 3.2 避免 RSC 属性中的重复序列化

**影响程度：低（通过避免重复序列化减少网络负载）**

RSC 到客户端的序列化按对象引用去重，而非按值。同一引用 = 序列化一次；新引用 = 再次序列化。转换操作（`.toSorted()`、`.filter()`、`.map()`）应在客户端执行，而非服务端。

**错误做法：重复序列化数组**

```tsx
// RSC：发送 6 个字符串（2 个数组 × 3 项）
<ClientList usernames={usernames} usernamesOrdered={usernames.toSorted()} />
```

**正确做法：仅发送 3 个字符串**

```tsx
// RSC：只发送一次
<ClientList usernames={usernames} />

// 客户端：在那里转换
'use client'
const sorted = useMemo(() => [...usernames].sort(), [usernames])
```

**嵌套去重行为：**

```tsx
// string[] — 重复所有内容
usernames={['a','b']} sorted={usernames.toSorted()} // 发送 4 个字符串

// object[] — 仅重复数组结构
users={[{id:1},{id:2}]} sorted={users.toSorted()} // 发送 2 个数组 + 2 个唯一对象（不是 4 个）
```

去重是递归工作的。按数据类型影响不同：

- `string[]`、`number[]`、`boolean[]`：**高影响** — 数组及所有原始值完全重复
- `object[]`：**低影响** — 数组重复，但嵌套对象按引用去重

**破坏去重的操作：创建新引用**

- 数组：`.toSorted()`、`.filter()`、`.map()`、`.slice()`、`[...arr]`
- 对象：`{...obj}`、`Object.assign()`、`structuredClone()`、`JSON.parse(JSON.stringify())`

**更多示例：**

```tsx
// ❌ 错误
<C users={users} active={users.filter(u => u.active)} />
<C product={product} productName={product.name} />

// ✅ 正确
<C users={users} />
<C product={product} />
// 在客户端进行过滤/解构
```

**例外：** 当转换开销较大或客户端不需要原始数据时，可以传入派生数据。

### 3.3 跨请求 LRU 缓存

**影响程度：高（跨请求缓存）**

`React.cache()` 仅在单个请求内工作。对于跨顺序请求共享的数据（用户先点击按钮 A 再点击按钮 B），使用 LRU 缓存。

**实现：**

```typescript
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, any>({
  max: 1000,
  ttl: 5 * 60 * 1000  // 5 分钟
})

export async function getUser(id: string) {
  const cached = cache.get(id)
  if (cached) return cached

  const user = await db.user.findUnique({ where: { id } })
  cache.set(id, user)
  return user
}

// 请求 1：数据库查询，结果被缓存
// 请求 2：缓存命中，无需数据库查询
```

当顺序用户操作在数秒内命中多个需要相同数据的端点时使用。

**使用 Vercel 的 [Fluid Compute](https://vercel.com/docs/fluid-compute)：** LRU 缓存特别有效，因为多个并发请求可以共享同一个函数实例和缓存。这意味着缓存跨请求持久存在，无需 Redis 等外部存储。

**传统无服务架构：** 每次调用在隔离环境中运行，因此跨进程缓存可考虑使用 Redis。

参考：[https://github.com/isaacs/node-lru-cache](https://github.com/isaacs/node-lru-cache)

### 3.4 最小化 RSC 边界处的序列化

**影响程度：高（减少数据传输量）**

React 服务端/客户端边界将所有对象属性序列化为字符串，并嵌入 HTML 响应和后续 RSC 请求中。序列化数据直接影响页面重量和加载时间，因此**大小非常重要**。只传递客户端实际使用的字段。

**错误做法：序列化全部 50 个字段**

```tsx
async function Page() {
  const user = await fetchUser()  // 50 个字段
  return <Profile user={user} />
}

'use client'
function Profile({ user }: { user: User }) {
  return <div>{user.name}</div>  // 仅使用 1 个字段
}
```

**正确做法：仅序列化 1 个字段**

```tsx
async function Page() {
  const user = await fetchUser()
  return <Profile name={user.name} />
}

'use client'
function Profile({ name }: { name: string }) {
  return <div>{name}</div>
}
```

### 3.5 通过组件组合并行获取数据

**影响程度：关键级（消除服务端瀑布流）**

React 服务端组件在组件树中按顺序执行。通过组合重构以并行化数据获取。

**错误做法：Sidebar 等待 Page 的获取完成**

```tsx
export default async function Page() {
  const header = await fetchHeader()
  return (
    <div>
      <div>{header}</div>
      <Sidebar />
    </div>
  )
}

async function Sidebar() {
  const items = await fetchSidebarItems()
  return <nav>{items.map(renderItem)}</nav>
}
```

**正确做法：两者同时获取**

```tsx
async function Header() {
  const data = await fetchHeader()
  return <div>{data}</div>
}

async function Sidebar() {
  const items = await fetchSidebarItems()
  return <nav>{items.map(renderItem)}</nav>
}

export default function Page() {
  return (
    <div>
      <Header />
      <Sidebar />
    </div>
  )
}
```

**使用 children prop 的替代方案：**

```tsx
async function Header() {
  const data = await fetchHeader()
  return <div>{data}</div>
}

async function Sidebar() {
  const items = await fetchSidebarItems()
  return <nav>{items.map(renderItem)}</nav>
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div>
      <Header />
      {children}
    </div>
  )
}

export default function Page() {
  return (
    <Layout>
      <Sidebar />
    </Layout>
  )
}
```

### 3.6 使用 React.cache() 做请求级去重

**影响程度：中（在请求内去重）**

使用 `React.cache()` 进行服务端请求去重。认证和数据库查询受益最大。

**用法：**

```typescript
import { cache } from 'react'

export const getCurrentUser = cache(async () => {
  const session = await auth()
  if (!session?.user?.id) return null
  return await db.user.findUnique({
    where: { id: session.user.id }
  })
})
```

在同一个请求中，多次调用 `getCurrentUser()` 只会执行一次查询。

**避免使用内联对象作为参数：**

`React.cache()` 使用浅比较（`Object.is`）来判断缓存命中。内联对象每次调用都创建新引用，导致缓存失效。

**错误做法：总是缓存未命中**

```typescript
const getUser = cache(async (params: { uid: number }) => {
  return await db.user.findUnique({ where: { id: params.uid } })
})

// 每次调用都创建新对象，永远不会命中缓存
getUser({ uid: 1 })
getUser({ uid: 1 })  // 缓存未命中，再次运行查询
```

**正确做法：缓存命中**

```typescript
const params = { uid: 1 }
getUser(params)  // 查询运行
getUser(params)  // 缓存命中（同一引用）
```

如果必须传递对象，请传递同一引用：

**Next.js 特有说明：**

在 Next.js 中，`fetch` API 被自动扩展了请求记忆功能。URL 和选项相同的请求在单个请求内自动去重，因此 `fetch` 调用不需要 `React.cache()`。但是，`React.cache()` 对于其他异步任务仍然至关重要：

- 数据库查询（Prisma、Drizzle 等）
- 重型计算
- 认证检查
- 文件系统操作
- 任何非 fetch 的异步工作

使用 `React.cache()` 在你的组件树中对这些操作进行去重。

参考：[https://react.dev/reference/react/cache](https://react.dev/reference/react/cache)

### 3.7 使用 after() 执行非阻塞操作

**影响程度：中（更快的响应时间）**

使用 Next.js 的 `after()` 来安排在响应发送后执行的工作。这可以防止日志记录、分析和其他副作用阻塞响应。

**错误做法：阻塞响应**

```tsx
import { logUserAction } from '@/app/utils'

export async function POST(request: Request) {
  // 执行变更
  await updateDatabase(request)

  // 日志记录阻塞了响应
  const userAgent = request.headers.get('user-agent') || 'unknown'
  await logUserAction({ userAgent })

  return new Response(JSON.stringify({ status: 'success' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
```

**正确做法：非阻塞**

```tsx
import { after } from 'next/server'
import { headers, cookies } from 'next/headers'
import { logUserAction } from '@/app/utils'

export async function POST(request: Request) {
  // 执行变更
  await updateDatabase(request)

  // 响应发送后记录日志
  after(async () => {
    const userAgent = (await headers()).get('user-agent') || 'unknown'
    const sessionCookie = (await cookies()).get('session-id')?.value || 'anonymous'

    logUserAction({ sessionCookie, userAgent })
  })

  return new Response(JSON.stringify({ status: 'success' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
```

响应立即发送，而日志记录在后台进行。

**常见用例：**

- 分析追踪
- 审计日志
- 发送通知
- 缓存失效
- 清理任务

**重要提示：**

- `after()` 即使响应失败或重定向也会运行
- 在 Server Actions、Route Handlers 和 Server Components 中均可使用

参考：[https://nextjs.org/docs/app/api-reference/functions/after](https://nextjs.org/docs/app/api-reference/functions/after)

---

## 4. 客户端数据获取

**影响程度：中高**

自动去重和高效的数据获取模式减少了冗余的网络请求。

### 4.1 全局事件监听器去重

**影响程度：低（N 个组件共用 1 个监听器）**

使用 `useSWRSubscription()` 跨组件实例共享全局事件监听器。

**错误做法：N 个实例 = N 个监听器**

```tsx
function useKeyboardShortcut(key: string, callback: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === key) {
        callback()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, callback])
}
```

使用多次 `useKeyboardShortcut` 钩子时，每次都会注册新的监听器。

**正确做法：N 个实例 = 1 个监听器**

```tsx
import useSWRSubscription from 'swr/subscription'

// 模块级 Map，按 key 跟踪回调
const keyCallbacks = new Map<string, Set<() => void>>()

function useKeyboardShortcut(key: string, callback: () => void) {
  // 在 Map 中注册此回调
  useEffect(() => {
    if (!keyCallbacks.has(key)) {
      keyCallbacks.set(key, new Set())
    }
    keyCallbacks.get(key)!.add(callback)

    return () => {
      const set = keyCallbacks.get(key)
      if (set) {
        set.delete(callback)
        if (set.size === 0) {
          keyCallbacks.delete(key)
        }
      }
    }
  }, [key, callback])

  useSWRSubscription('global-keydown', () => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && keyCallbacks.has(e.key)) {
        keyCallbacks.get(e.key)!.forEach(cb => cb())
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })
}

function Profile() {
  // 多个快捷键共享同一个监听器
  useKeyboardShortcut('p', () => { /* ... */ })
  useKeyboardShortcut('k', () => { /* ... */ })
  // ...
}
```

### 4.2 滚动性能使用被动事件监听器

**影响程度：中（消除事件监听器导致的滚动延迟）**

对触摸和滚轮事件监听器添加 `{ passive: true }` 以启用即时滚动。浏览器通常等待监听器执行完毕以检查是否调用了 `preventDefault()`，从而导致滚动延迟。

**错误做法：**

```typescript
useEffect(() => {
  const handleTouch = (e: TouchEvent) => console.log(e.touches[0].clientX)
  const handleWheel = (e: WheelEvent) => console.log(e.deltaY)

  document.addEventListener('touchstart', handleTouch)
  document.addEventListener('wheel', handleWheel)

  return () => {
    document.removeEventListener('touchstart', handleTouch)
    document.removeEventListener('wheel', handleWheel)
  }
}, [])
```

**正确做法：**

```typescript
useEffect(() => {
  const handleTouch = (e: TouchEvent) => console.log(e.touches[0].clientX)
  const handleWheel = (e: WheelEvent) => console.log(e.deltaY)

  document.addEventListener('touchstart', handleTouch, { passive: true })
  document.addEventListener('wheel', handleWheel, { passive: true })

  return () => {
    document.removeEventListener('touchstart', handleTouch)
    document.removeEventListener('wheel', handleWheel)
  }
}, [])
```

**使用 passive 的场景：** 追踪/分析、日志记录、任何不调用 `preventDefault()` 的监听器。

**不使用 passive 的场景：** 实现自定义滑动手势、自定义缩放控制，或任何需要 `preventDefault()` 的监听器。

### 4.3 使用 SWR 自动去重

**影响程度：中高（自动去重）**

SWR 实现跨组件实例的请求去重、缓存和重新验证。

**错误做法：无去重，每个实例都获取**

```tsx
function UserList() {
  const [users, setUsers] = useState([])
  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(setUsers)
  }, [])
}
```

**正确做法：多个实例共享一个请求**

```tsx
import useSWR from 'swr'

function UserList() {
  const { data: users } = useSWR('/api/users', fetcher)
}
```

**不可变数据：**

```tsx
import { useImmutableSWR } from '@/lib/swr'

function StaticContent() {
  const { data } = useImmutableSWR('/api/config', fetcher)
}
```

**变更操作：**

```tsx
import { useSWRMutation } from 'swr/mutation'

function UpdateButton() {
  const { trigger } = useSWRMutation('/api/user', updateUser)
  return <button onClick={() => trigger()}>Update</button>
}
```

参考：[https://swr.vercel.app](https://swr.vercel.app)

### 4.4 版本化并最小化 localStorage 数据

**影响程度：中（防止架构冲突，减少存储大小）**

为键添加版本前缀，仅存储需要的字段。防止架构冲突和意外存储敏感数据。

**错误做法：**

```typescript
// 无版本，存储所有内容，无错误处理
localStorage.setItem('userConfig', JSON.stringify(fullUserObject))
const data = localStorage.getItem('userConfig')
```

**正确做法：**

```typescript
const VERSION = 'v2'

function saveConfig(config: { theme: string; language: string }) {
  try {
    localStorage.setItem(`userConfig:${VERSION}`, JSON.stringify(config))
  } catch {
    // 在无痕/隐私浏览、超出配额或禁用时抛出
  }
}

function loadConfig() {
  try {
    const data = localStorage.getItem(`userConfig:${VERSION}`)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

// 从 v1 迁移到 v2
function migrate() {
  try {
    const v1 = localStorage.getItem('userConfig:v1')
    if (v1) {
      const old = JSON.parse(v1)
      saveConfig({ theme: old.darkMode ? 'dark' : 'light', language: old.lang })
      localStorage.removeItem('userConfig:v1')
    }
  } catch {}
}
```

**从服务器响应中仅存储需要的字段：**

```typescript
// 用户对象有 20+ 个字段，界面只需要其中几个
function cachePrefs(user: FullUser) {
  try {
    localStorage.setItem('prefs:v1', JSON.stringify({
      theme: user.preferences.theme,
      notifications: user.preferences.notifications
    }))
  } catch {}
}
```

**始终使用 try-catch 包裹：** `getItem()` 和 `setItem()` 在无痕/隐私浏览（Safari、Firefox）、超出配额或禁用时会抛出错误。

**好处：** 通过版本控制实现架构演进、减少存储大小、防止存储令牌/PII/内部标记。

---

## 5. 重渲染优化

**影响程度：中**

减少不必要的重渲染可以最小化浪费的计算并改善界面响应性。

### 5.1 在渲染过程中计算派生状态

**影响程度：中（避免冗余渲染和状态漂移）**

如果一个值可以从当前属性/状态中计算得出，不要将它存储在 state 中，也不要在 effect 中更新它。在渲染期间派生，以避免额外的渲染和状态漂移。不要仅为了响应属性变化而在 effect 中设置状态；优先使用派生值或键重置。

**错误做法：冗余的 state 和 effect**

```tsx
function Form() {
  const [firstName, setFirstName] = useState('First')
  const [lastName, setLastName] = useState('Last')
  const [fullName, setFullName] = useState('')

  useEffect(() => {
    setFullName(firstName + ' ' + lastName)
  }, [firstName, lastName])

  return <p>{fullName}</p>
}
```

**正确做法：在渲染期间派生**

```tsx
function Form() {
  const [firstName, setFirstName] = useState('First')
  const [lastName, setLastName] = useState('Last')
  const fullName = firstName + ' ' + lastName

  return <p>{fullName}</p>
}
```

参考：[https://react.dev/learn/you-might-not-need-an-effect](https://react.dev/learn/you-might-not-need-an-effect)

### 5.2 状态读取延迟到使用点

**影响程度：中（避免不必要的订阅）**

如果只在回调中读取动态状态（searchParams、localStorage），不要订阅它。

**错误做法：订阅所有 searchParams 的变化**

```tsx
function ShareButton({ chatId }: { chatId: string }) {
  const searchParams = useSearchParams()

  const handleShare = () => {
    const ref = searchParams.get('ref')
    shareChat(chatId, { ref })
  }

  return <button onClick={handleShare}>Share</button>
}
```

**正确做法：按需读取，无需订阅**

```tsx
function ShareButton({ chatId }: { chatId: string }) {
  const handleShare = () => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    shareChat(chatId, { ref })
  }

  return <button onClick={handleShare}>Share</button>
}
```

### 5.3 不要对原始结果类型的简单表达式使用 useMemo 包装

**影响程度：低中（每次渲染浪费计算）**

当表达式简单（少量逻辑或算术运算符）且结果为原始类型（布尔值、数字、字符串）时，不要用 `useMemo` 包装它。

调用 `useMemo` 和比较 hook 依赖所消耗的资源可能比表达式本身更多。

**错误做法：**

```tsx
function Header({ user, notifications }: Props) {
  const isLoading = useMemo(() => {
    return user.isLoading || notifications.isLoading
  }, [user.isLoading, notifications.isLoading])

  if (isLoading) return <Skeleton />
  // return some markup
}
```

**正确做法：**

```tsx
function Header({ user, notifications }: Props) {
  const isLoading = user.isLoading || notifications.isLoading

  if (isLoading) return <Skeleton />
  // return some markup
}
```

### 5.4 将 memoized 组件的默认非原始参数值提取为常量

**影响程度：中（通过使用常量恢复记忆化）**

当 memoized 组件对某个非原始可选参数有默认值（如数组、函数或对象）时，不传该参数调用组件会导致记忆化失效。这是因为每次重渲染都会创建新值实例，且它们不通过 `memo()` 中的严格相等比较。

要解决此问题，将默认值提取为常量。

**错误做法：每次重渲染 `onClick` 的值都不同**

```tsx
const UserAvatar = memo(function UserAvatar({ onClick = () => {} }: { onClick?: () => void }) {
  // ...
})

// 使用时不传可选 onClick
<UserAvatar />
```

**正确做法：稳定的默认值**

```tsx
const NOOP = () => {};

const UserAvatar = memo(function UserAvatar({ onClick = NOOP }: { onClick?: () => void }) {
  // ...
})

// 使用时不传可选 onClick
<UserAvatar />
```

### 5.5 提取为 memoized 组件

**影响程度：中（支持提前返回）**

将昂贵的工作提取到 memoized 组件中，以便在计算前进行提前返回。

**错误做法：加载时仍计算 avatar**

```tsx
function Profile({ user, loading }: Props) {
  const avatar = useMemo(() => {
    const id = computeAvatarId(user)
    return <Avatar id={id} />
  }, [user])

  if (loading) return <Skeleton />
  return <div>{avatar}</div>
}
```

**正确做法：加载时跳过计算**

```tsx
const UserAvatar = memo(function UserAvatar({ user }: { user: User }) {
  const id = useMemo(() => computeAvatarId(user), [user])
  return <Avatar id={id} />
})

function Profile({ user, loading }: Props) {
  if (loading) return <Skeleton />
  return (
    <div>
      <UserAvatar user={user} />
    </div>
  )
}
```

**注意：** 如果你的项目启用了 [React Compiler](https://react.dev/learn/react-compiler)，则不需要手动使用 `memo()` 和 `useMemo()`。编译器会自动优化重渲染。

### 5.6 缩小 effect 的依赖范围

**影响程度：低（最小化 effect 重运行次数）**

指定原始类型依赖而非对象，以最小化 effect 重运行次数。

**错误做法：任何 user 字段变化时都重运行**

```tsx
useEffect(() => {
  console.log(user.id)
}, [user])
```

**正确做法：仅在 id 变化时重运行**

```tsx
useEffect(() => {
  console.log(user.id)
}, [user.id])
```

**对于派生状态，在 effect 外部计算：**

```tsx
// 错误做法：在 width=767, 766, 765... 时运行
useEffect(() => {
  if (width < 768) {
    enableMobileMode()
  }
}, [width])

// 正确做法：仅在布尔值转换时运行
const isMobile = width < 768
useEffect(() => {
  if (isMobile) {
    enableMobileMode()
  }
}, [isMobile])
```

### 5.7 交互逻辑放在事件处理器中

**影响程度：中（避免 effect 重运行和重复副作用）**

如果副作用由特定用户操作触发（提交、点击、拖拽），在该事件处理器中运行它。不要将操作建模为 state + effect；这会导致 effect 在不相关的变更上重运行，并可能重复操作。

**错误做法：事件被建模为 state + effect**

```tsx
function Form() {
  const [submitted, setSubmitted] = useState(false)
  const theme = useContext(ThemeContext)

  useEffect(() => {
    if (submitted) {
      post('/api/register')
      showToast('Registered', theme)
    }
  }, [submitted, theme])

  return <button onClick={() => setSubmitted(true)}>Submit</button>
}
```

**正确做法：在处理器中完成**

```tsx
function Form() {
  const theme = useContext(ThemeContext)

  function handleSubmit() {
    post('/api/register')
    showToast('Registered', theme)
  }

  return <button onClick={handleSubmit}>Submit</button>
}
```

参考：[https://react.dev/learn/removing-effect-dependencies#should-this-code-move-to-an-event-handler](https://react.dev/learn/removing-effect-dependencies#should-this-code-move-to-an-event-handler)

### 5.8 订阅派生状态

**影响程度：中（降低重渲染频率）**

订阅派生的布尔状态而非连续值，以降低重渲染频率。

**错误做法：每次像素变化都重渲染**

```tsx
function Sidebar() {
  const width = useWindowWidth()  // 持续更新
  const isMobile = width < 768
  return <nav className={isMobile ? 'mobile' : 'desktop'} />
}
```

**正确做法：仅在布尔值变化时重渲染**

```tsx
function Sidebar() {
  const isMobile = useMediaQuery('(max-width: 767px)')
  return <nav className={isMobile ? 'mobile' : 'desktop'} />
}
```

### 5.9 使用函数式 setState 更新

**影响程度：中（防止过期闭包和不必要的回调重建）**

当基于当前 state 值更新 state 时，使用 setState 的函数式更新形式而非直接引用 state 变量。这可以防止过期闭包，消除不必要的依赖，并创建稳定的回调引用。

**错误做法：需要 state 作为依赖**

```tsx
function TodoList() {
  const [items, setItems] = useState(initialItems)

  // 回调必须依赖 items，每次 items 变化时重建
  const addItems = useCallback((newItems: Item[]) => {
    setItems([...items, ...newItems])
  }, [items])  // ❌ items 依赖导致频繁重建

  // 如果忘记依赖则有过期闭包风险
  const removeItem = useCallback((id: string) => {
    setItems(items.filter(item => item.id !== id))
  }, [])  // ❌ 缺少 items 依赖 — 将使用过期的 items！

  return <ItemsEditor items={items} onAdd={addItems} onRemove={removeItem} />
}
```

第一个回调在 `items` 每次变化时重新创建，可能导致子组件不必要地重渲染。第二个回调有过期闭包 bug——它将始终引用初始的 `items` 值。

**正确做法：稳定的回调，无过期闭包**

```tsx
function TodoList() {
  const [items, setItems] = useState(initialItems)

  // 稳定的回调，永不重建
  const addItems = useCallback((newItems: Item[]) => {
    setItems(curr => [...curr, ...newItems])
  }, [])  // ✅ 无需依赖

  // 始终使用最新的 state，无过期闭包风险
  const removeItem = useCallback((id: string) => {
    setItems(curr => curr.filter(item => item.id !== id))
  }, [])  // ✅ 安全且稳定

  return <ItemsEditor items={items} onAdd={addItems} onRemove={removeItem} />
}
```

**好处：**

1. **稳定的回调引用** — 回调不需要在 state 变化时重新创建
2. **无过期闭包** — 始终操作最新的 state 值
3. **更少的依赖** — 简化依赖数组，减少内存泄漏
4. **防止 bug** — 消除了 React 闘包 bug 的最常见来源

**使用函数式更新的场景：**

- 任何依赖当前 state 值的 setState
- 在 useCallback/useMemo 内部需要 state 时
- 引用 state 的事件处理器
- 更新 state 的异步操作

**直接更新就足够的场景：**

- 将 state 设置为静态值：`setCount(0)`
- 仅从属性/参数设置 state：`setName(newName)`
- state 不依赖先前的值

**注意：** 如果你的项目启用了 [React Compiler](https://react.dev/learn/react-compiler)，编译器可以自动优化某些场景，但函数式更新仍然推荐用于确保正确性和防止过期闭包 bug。

### 5.10 使用惰性状态初始化

**影响程度：中（每次渲染浪费计算）**

对于昂贵的初始值，向 `useState` 传递一个函数。如果不使用函数形式，初始化器在每次渲染时都会运行，尽管该值只使用一次。

**错误做法：每次渲染都运行**

```tsx
function FilteredList({ items }: { items: Item[] }) {
  // buildSearchIndex() 在每次渲染时运行，即使在初始化之后
  const [searchIndex, setSearchIndex] = useState(buildSearchIndex(items))
  const [query, setQuery] = useState('')

  // 当 query 变化时，buildSearchIndex 再次不必要地运行
  return <SearchResults index={searchIndex} query={query} />
}

function UserProfile() {
  // JSON.parse 在每次渲染时运行
  const [settings, setSettings] = useState(
    JSON.parse(localStorage.getItem('settings') || '{}')
  )

  return <SettingsForm settings={settings} onChange={setSettings} />
}
```

**正确做法：仅运行一次**

```tsx
function FilteredList({ items }: { items: Item[] }) {
  // buildSearchIndex() 仅在初始渲染时运行
  const [searchIndex, setSearchIndex] = useState(() => buildSearchIndex(items))
  const [query, setQuery] = useState('')

  return <SearchResults index={searchIndex} query={query} />
}

function UserProfile() {
  // JSON.parse 仅在初始渲染时运行
  const [settings, setSettings] = useState(() => {
    const stored = localStorage.getItem('settings')
    return stored ? JSON.parse(stored) : {}
  })

  return <SettingsForm settings={settings} onChange={setSettings} />
}
```

在从 localStorage/sessionStorage 计算初始值、构建数据结构（索引、映射）、读取 DOM 或执行重型转换时使用惰性初始化。

对于简单的原始值（`useState(0)`）、直接引用（`useState(props.value)`）或廉价字面量（`useState({})`），不需要函数形式。

### 5.11 使用 Transitions 处理非紧急更新

**影响程度：中（保持界面响应性）**

将频繁的、非紧急的 state 更新标记为过渡（transition），以保持界面响应性。

**错误做法：每次滚动都阻塞界面**

```tsx
function ScrollTracker() {
  const [scrollY, setScrollY] = useState(0)
  useEffect(() => {
    const handler = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])
}
```

**正确做法：非阻塞更新**

```tsx
import { startTransition } from 'react'

function ScrollTracker() {
  const [scrollY, setScrollY] = useState(0)
  useEffect(() => {
    const handler = () => {
      startTransition(() => setScrollY(window.scrollY))
    }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])
}
```

### 5.12 对瞬态值使用 useRef

**影响程度：中（避免频繁更新导致的不必要重渲染）**

当一个值变化频繁且你不想在每次更新时都重渲染时（例如鼠标追踪器、定时器、瞬态标记），将其存储在 `useRef` 而非 `useState` 中。组件 state 保留给界面使用；ref 用于临时的 DOM 相邻值。更新 ref 不会触发重渲染。

**错误做法：每次更新都渲染**

```tsx
function Tracker() {
  const [lastX, setLastX] = useState(0)

  useEffect(() => {
    const onMove = (e: MouseEvent) => setLastX(e.clientX)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: lastX,
        width: 8,
        height: 8,
        background: 'black',
      }}
    />
  )
}
```

**正确做法：追踪时不重渲染**

```tsx
function Tracker() {
  const lastXRef = useRef(0)
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      lastXRef.current = e.clientX
      const node = dotRef.current
      if (node) {
        node.style.transform = `translateX(${e.clientX}px)`
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div
      ref={dotRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 8,
        height: 8,
        background: 'black',
        transform: 'translateX(0px)',
      }}
    />
  )
}
```

---

## 6. 渲染性能

**影响程度：中**

优化渲染过程可以减少浏览器需要做的工作。

### 6.1 动画 SVG 的包裹元素而非 SVG 本身

**影响程度：低（启用硬件加速）**

许多浏览器对 SVG 元素上的 CSS3 动画没有硬件加速。将 SVG 包裹在 `<div>` 中，对包裹元素做动画。

**错误做法：直接动画 SVG — 无硬件加速**

```tsx
function LoadingSpinner() {
  return (
    <svg
      className="animate-spin"
      width="24"
      height="24"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" />
    </svg>
  )
}
```

**正确做法：动画包裹 div — 硬件加速**

```tsx
function LoadingSpinner() {
  return (
    <div className="animate-spin">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" />
      </svg>
    </div>
  )
}
```

这适用于所有 CSS 变换和过渡（`transform`、`opacity`、`translate`、`scale`、`rotate`）。包裹 div 允许浏览器使用 GPU 加速实现更流畅的动画。

### 6.2 长列表使用 CSS content-visibility

**影响程度：高（更快的初始渲染）**

对离屏渲染应用 `content-visibility: auto` 以延迟渲染。

**CSS：**

```css
.message-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 80px;
}
```

**示例：**

```tsx
function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="overflow-y-auto h-screen">
      {messages.map(msg => (
        <div key={msg.id} className="message-item">
          <Avatar user={msg.author} />
          <div>{msg.content}</div>
        </div>
      ))}
    </div>
  )
}
```

对于 1000 条消息，浏览器会跳过约 990 个离屏项目的布局/绘制（初始渲染快 10 倍）。

### 6.3 提升静态 JSX 元素

**影响程度：低（避免重复创建）**

将静态 JSX 提取到组件外部，避免每次渲染都重新创建。

**错误做法：每次渲染都重新创建元素**

```tsx
function LoadingSkeleton() {
  return <div className="animate-pulse h-20 bg-gray-200" />
}

function Container() {
  return (
    <div>
      {loading && <LoadingSkeleton />}
    </div>
  )
}
```

**正确做法：复用同一元素**

```tsx
const loadingSkeleton = (
  <div className="animate-pulse h-20 bg-gray-200" />
)

function Container() {
  return (
    <div>
      {loading && loadingSkeleton}
    </div>
  )
}
```

这对于大型静态 SVG 节点特别有帮助，每次渲染重新创建它们的开销可能很大。

**注意：** 如果你的项目启用了 [React Compiler](https://react.dev/learn/react-compiler)，编译器会自动提升静态 JSX 元素并优化组件重渲染，无需手动提升。

### 6.4 优化 SVG 精度

**影响程度：低（减少文件大小）**

降低 SVG 坐标精度以减少文件大小。最佳精度取决于 viewBox 大小，但通常应尽量减少精度。

**错误做法：过度精度**

```svg
<path d="M 10.293847 20.847362 L 30.938472 40.192837" />
```

**正确做法：保留 1 位小数**

```svg
<path d="M 10.3 20.8 L 30.9 40.2" />
```

**使用 SVGO 自动化：**

```bash
npx svgo --precision=1 --multipass icon.svg
```

### 6.5 无闪烁地防止水合不匹配

**影响程度：中（避免视觉闪烁和水合错误）**

在渲染依赖于客户端存储（localStorage、cookie）的内容时，通过在 React 水合之前注入同步脚本更新 DOM，来避免 SSR 损坏和水合后的闪烁。

**错误做法：破坏 SSR**

```tsx
function ThemeWrapper({ children }: { children: ReactNode }) {
  // 服务端没有 localStorage — 抛出错误
  const theme = localStorage.getItem('theme') || 'light'

  return (
    <div className={theme}>
      {children}
    </div>
  )
}
```

服务端渲染会失败，因为 `localStorage` 是 undefined。

**错误做法：视觉闪烁**

```tsx
function ThemeWrapper({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    // 水合后运行 — 导致可见闪烁
    const stored = localStorage.getItem('theme')
    if (stored) {
      setTheme(stored)
    }
  }, [])

  return (
    <div className={theme}>
      {children}
    </div>
  )
}
```

组件首先使用默认值（`light`）渲染，然后在 hydration 后更新，导致错误内容的可见闪烁。

**正确做法：无闪烁，无水合不匹配**

```tsx
function ThemeWrapper({ children }: { children: ReactNode }) {
  return (
    <>
      <div id="theme-wrapper">
        {children}
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var theme = localStorage.getItem('theme') || 'light';
                var el = document.getElementById('theme-wrapper');
                if (el) el.className = theme;
              } catch (e) {}
            })();
          `,
        }}
      />
    </>
  )
}
```

内联脚本在显示元素之前同步执行，确保 DOM 已经有正确的值。无闪烁，无水合不匹配。

此模式对于主题切换、用户偏好、认证状态和任何应该立即渲染而无默认值闪烁的客户端数据特别有用。

### 6.6 抑制预期的水合不匹配

**影响程度：低中（为已知差异避免嘈杂的水合警告）**

在 SSR 框架（如 Next.js）中，某些值在服务端和客户端上故意不同（随机 ID、日期、区域/时区格式化）。对于这些**预期的**不匹配，将动态文本包裹在带有 `suppressHydrationWarning` 的元素中，以避免嘈杂的警告。不要用此隐藏真实的 bug。不要过度使用。

**错误做法：已知不匹配的警告**

```tsx
function Timestamp() {
  return <span>{new Date().toLocaleString()}</span>
}
```

**正确做法：仅抑制预期的匹配**

```tsx
function Timestamp() {
  return (
    <span suppressHydrationWarning>
      {new Date().toLocaleString()}
    </span>
  )
}
```

### 6.7 使用 Activity 组件控制显隐

**影响程度：中（保留状态/DOM）**

对于频繁切换可见性的昂贵组件，使用 React 的 `<Activity>` 来保留状态/DOM。

**用法：**

```tsx
import { Activity } from 'react'

function Dropdown({ isOpen }: Props) {
  return (
    <Activity mode={isOpen ? 'visible' : 'hidden'}>
      <ExpensiveMenu />
    </Activity>
  )
}
```

避免昂贵的重渲染和状态丢失。

### 6.8 使用显式条件渲染

**影响程度：低（防止渲染 0 或 NaN）**

当条件可能为 `0`、`NaN` 或其他会渲染的假值时，使用显式的三元运算符（`? :`）而非 `&&` 进行条件渲染。

**错误做法：count 为 0 时渲染 "0"**

```tsx
function Badge({ count }: { count: number }) {
  return (
    <div>
      {count && <span className="badge">{count}</span>}
    </div>
  )
}

// count = 0 时渲染：<div>0</div>
// count = 5 时渲染：<div><span class="badge">5</span></div>
```

**正确做法：count 为 0 时不渲染**

```tsx
function Badge({ count }: { count: number }) {
  return (
    <div>
      {count > 0 ? <span className="badge">{count}</span> : null}
    </div>
  )
}

// count = 0 时渲染：<div></div>
// count = 5 时渲染：<div><span class="badge">5</span></div>
```

### 6.9 使用 useTransition 而非手动加载状态

**影响程度：低（减少重渲染并提高代码清晰度）**

使用 `useTransition` 而非手动的 `useState` 来管理加载状态。这提供了内置的 `isPending` 状态并自动管理过渡。

**错误做法：手动加载状态**

```tsx
function SearchResults() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const handleSearch = async (value: string) => {
    setIsLoading(true)
    setQuery(value)
    const data = await fetchResults(value)
    setResults(data)
    setIsLoading(false)
  }

  return (
    <>
      <input onChange={(e) => handleSearch(e.target.value)} />
      {isLoading && <Spinner />}
      <ResultsList results={results} />
    </>
  )
}
```

**正确做法：使用 useTransition 和内置的 pending 状态**

```tsx
import { useTransition, useState } from 'react'

function SearchResults() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isPending, startTransition] = useTransition()

  const handleSearch = (value: string) => {
    setQuery(value) // 立即更新输入

    startTransition(async () => {
      // 获取并更新结果
      const data = await fetchResults(value)
      setResults(data)
    })
  }

  return (
    <>
      <input onChange={(e) => handleSearch(e.target.value)} />
      {isPending && <Spinner />}
      <ResultsList results={results} />
    </>
  )
}
```

**好处：**

- **自动 pending 状态**：无需手动管理 `setIsLoading(true/false)`
- **错误恢复能力**：即使过渡抛出异常，pending 状态也能正确重置
- **更好的响应性**：在更新期间保持界面响应
- **中断处理**：新的过渡自动取消挂起的过渡

参考：[https://react.dev/reference/react/useTransition](https://react.dev/reference/react/useTransition)

---

## 7. JavaScript 性能

**影响程度：低中**

热路径上的微优化可以累积成有意义的改进。

### 7.1 避免布局抖动

**影响程度：中（防止强制同步布局并减少性能瓶颈）**

避免在样式写入和布局读取之间交错操作。当你在样式更改之间读取布局属性（如 `offsetWidth`、`getBoundingClientRect()` 或 `getComputedStyle()`）时，浏览器被迫触发同步重排。

**这样做没问题：浏览器批量处理样式更改**

```typescript
function updateElementStyles(element: HTMLElement) {
  // 每一行都会使样式失效，但浏览器批量重新计算
  element.style.width = '100px'
  element.style.height = '200px'
  element.style.backgroundColor = 'blue'
  element.style.border = '1px solid black'
}
```

**错误做法：交错的读写强制重排**

```typescript
function layoutThrashing(element: HTMLElement) {
  element.style.width = '100px'
  const width = element.offsetWidth  // 强制重排
  element.style.height = '200px'
  const height = element.offsetHeight  // 再次强制重排
}
```

**正确做法：批量写入，然后一次性读取**

```typescript
function updateElementStyles(element: HTMLElement) {
  // 批量处理所有写入
  element.style.width = '100px'
  element.style.height = '200px'
  element.style.backgroundColor = 'blue'
  element.style.border = '1px solid black'

  // 在所有写入完成后读取（单次重排）
  const { width, height } = element.getBoundingClientRect()
}
```

**正确做法：批量读取，然后写入**

```typescript
function updateElementStyles(element: HTMLElement) {
  element.classList.add('highlighted-box')

  const { width, height } = element.getBoundingClientRect()
}
```

**更好的做法：使用 CSS 类**

**React 示例：**

```tsx
// 错误做法：样式更改与布局查询交错
function Box({ isHighlighted }: { isHighlighted: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current && isHighlighted) {
      ref.current.style.width = '100px'
      const width = ref.current.offsetWidth // 强制布局
      ref.current.style.height = '200px'
    }
  }, [isHighlighted])

  return <div ref={ref}>Content</div>
}

// 正确做法：切换类名
function Box({ isHighlighted }: { isHighlighted: boolean }) {
  return (
    <div className={isHighlighted ? 'highlighted-box' : ''}>
      Content
    </div>
  )
}
```

尽可能使用 CSS 类而非内联样式。CSS 文件被浏览器缓存，类名提供更好的关注点分离且更易维护。

更多信息参见 [this gist](https://gist.github.com/paulirish/5d52fb081b3570c81e3a) 和 [CSS Triggers](https://csstriggers.com/)。

### 7.2 为重复查找构建索引映射

**影响程度：低中（100 万次操作降至 2 千次）**

同一键的多次 `.find()` 调用应使用 Map。

**错误做法（每次查找 O(n)）：**

```typescript
function processOrders(orders: Order[], users: User[]) {
  return orders.map(order => ({
    ...order,
    user: users.find(u => u.id === order.userId)
  }))
}
```

**正确做法（每次查找 O(1)）：**

```typescript
function processOrders(orders: Order[], users: User[]) {
  const userById = new Map(users.map(u => [u.id, u]))

  return orders.map(order => ({
    ...order,
    user: userById.get(order.userId)
  }))
}
```

先构建映射（O(n)），之后所有查找都是 O(1)。

对于 1000 个订单 × 1000 个用户：100 万次操作 → 2 千次操作。

### 7.3 循环中缓存属性访问

**影响程度：低中（减少查找次数）**

在热路径中缓存对象属性查找。

**错误做法：3 次查找 × N 次迭代**

```typescript
for (let i = 0; i < arr.length; i++) {
  process(obj.config.settings.value)
}
```

**正确做法：仅 1 次总查找**

```typescript
const value = obj.config.settings.value
const len = arr.length
for (let i = 0; i < len; i++) {
  process(value)
}
```

### 7.4 缓存重复的函数调用

**影响程度：中（避免冗余计算）**

当同一函数在渲染过程中以相同输入被反复调用时，使用模块级 Map 缓存函数结果。

**错误做法：冗余计算**

```typescript
function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <div>
      {projects.map(project => {
        // slugify() 对相同的项目名称被调用 100+ 次
        const slug = slugify(project.name)

        return <ProjectCard key={project.id} slug={slug} />
      })}
    </div>
  )
}
```

**正确做法：缓存结果**

```typescript
// 模块级缓存
const slugifyCache = new Map<string, string>()

function cachedSlugify(text: string): string {
  if (slugifyCache.has(text)) {
    return slugifyCache.get(text)!
  }
  const result = slugify(text)
  slugifyCache.set(text, result)
  return result
}

function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <div>
      {projects.map(project => {
        // 每个唯一项目名称仅计算一次
        const slug = cachedSlugify(project.name)

        return <ProjectCard key={project.id} slug={slug} />
      })}
    </div>
  )
}
```

**单值函数的简化模式：**

```typescript
let isLoggedInCache: boolean | null = null

function isLoggedIn(): boolean {
  if (isLoggedInCache !== null) {
    return isLoggedInCache
  }

  isLoggedInCache = document.cookie.includes('auth=')
  return isLoggedInCache
}

// 认证变更时清除缓存
function onAuthChange() {
  isLoggedInCache = null
}
```

使用 Map（而非 hook），以便在工具函数、事件处理器等任何地方使用，而不仅限于 React 组件。

参考：[https://vercel.com/blog/how-we-made-the-vercel-dashboard-twice-as-fast](https://vercel.com/blog/how-we-made-the-vercel-dashboard-twice-as-fast)

### 7.5 缓存存储 API 调用

**影响程度：低中（减少昂贵的 I/O）**

`localStorage`、`sessionStorage` 和 `document.cookie` 是同步且昂贵的。在内存中缓存读取。

**错误做法：每次调用都读取存储**

```typescript
function getTheme() {
  return localStorage.getItem('theme') ?? 'light'
}
// 调用 10 次 = 10 次存储读取
```

**正确做法：Map 缓存**

```typescript
const storageCache = new Map<string, string | null>()

function getLocalStorage(key: string) {
  if (!storageCache.has(key)) {
    storageCache.set(key, localStorage.getItem(key))
  }
  return storageCache.get(key)
}

function setLocalStorage(key: string, value: string) {
  localStorage.setItem(key, value)
  storageCache.set(key, value)  // 保持缓存同步
}
```

使用 Map（而非 hook），以便在工具函数、事件处理器等任何地方使用。

**Cookie 缓存：**

```typescript
let cookieCache: Record<string, string> | null = null

function getCookie(name: string) {
  if (!cookieCache) {
    cookieCache = Object.fromEntries(
      document.cookie.split('; ').map(c => c.split('='))
    )
  }
  return cookieCache[name]
}
```

**重要：外部变更时失效**

```typescript
window.addEventListener('storage', (e) => {
  if (e.key) storageCache.delete(e.key)
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    storageCache.clear()
  }
})
```

如果存储可能被外部变更（另一个标签页、服务器设置的 cookie），则失效缓存：

### 7.6 合并多次数组迭代

**影响程度：低中（减少迭代次数）**

多次 `.filter()` 或 `.map()` 调用会多次遍历数组。合并为单次循环。

**错误做法：3 次迭代**

```typescript
const admins = users.filter(u => u.isAdmin)
const testers = users.filter(u => u.isTester)
const inactive = users.filter(u => !u.isActive)
```

**正确做法：1 次迭代**

```typescript
const admins: User[] = []
const testers: User[] = []
const inactive: User[] = []

for (const user of users) {
  if (user.isAdmin) admins.push(user)
  if (user.isTester) testers.push(user)
  if (!user.isActive) inactive.push(user)
}
```

### 7.7 数组比较前先检查长度

**影响程度：中高（长度不同时避免昂贵操作）**

当使用昂贵操作（排序、深度比较、序列化）比较数组时，先检查长度。如果长度不同，数组不可能相等。

在真实应用中，当此优化在热路径（事件处理器、渲染循环）中运行时特别有价值。

**错误做法：总是运行昂贵的比较**

```typescript
function hasChanges(current: string[], original: string[]) {
  // 即使长度不同也总是排序和连接
  return current.sort().join() !== original.sort().join()
}
```

当 `current.length` 是 5 而 `original.length` 是 100 时，仍然运行两次 O(n log n) 排序。还有连接数组和比较字符串的开销。

**正确做法（先做 O(1) 长度检查）：**

```typescript
function hasChanges(current: string[], original: string[]) {
  // 长度不同时提前返回
  if (current.length !== original.length) {
    return true
  }
  // 仅在长度匹配时排序
  const currentSorted = current.toSorted()
  const originalSorted = original.toSorted()
  for (let i = 0; i < currentSorted.length; i++) {
    if (currentSorted[i] !== originalSorted[i]) {
      return true
    }
  }
  return false
}
```

这种新方法更高效，因为：

- 在长度不同时避免了排序和连接的开销
- 避免了连接字符串的内存消耗（大数组尤其重要）
- 避免改变原始数组
- 发现差异时尽早返回

### 7.8 函数中尽早返回

**影响程度：低中（避免不必要的计算）**

当结果已确定时尽早返回，以跳过不必要的处理。

**错误做法：找到答案后仍处理所有项**

```typescript
function validateUsers(users: User[]) {
  let hasError = false
  let errorMessage = ''

  for (const user of users) {
    if (!user.email) {
      hasError = true
      errorMessage = 'Email required'
    }
    if (!user.name) {
      hasError = true
      errorMessage = 'Name required'
    }
    // 找到错误后仍继续检查所有用户
  }

  return hasError ? { valid: false, error: errorMessage } : { valid: true }
}
```

**正确做法：发现第一个错误时立即返回**

```typescript
function validateUsers(users: User[]) {
  for (const user of users) {
    if (!user.email) {
      return { valid: false, error: 'Email required' }
    }
    if (!user.name) {
      return { valid: false, error: 'Name required' }
    }
  }

  return { valid: true }
}
```

### 7.9 提升 RegExp 创建

**影响程度：低中（避免重复创建）**

不要在渲染中创建 RegExp。提升到模块作用域或用 `useMemo()` 记忆化。

**错误做法：每次渲染都创建新 RegExp**

```tsx
function Highlighter({ text, query }: Props) {
  const regex = new RegExp(`(${query})`, 'gi')
  const parts = text.split(regex)
  return <>{parts.map((part, i) => ...)}</>
}
```

**正确做法：记忆化或提升**

```tsx
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Highlighter({ text, query }: Props) {
  const regex = useMemo(
    () => new RegExp(`(${escapeRegex(query)})`, 'gi'),
    [query]
  )
  const parts = text.split(regex)
  return <>{parts.map((part, i) => ...)}</>
}
```

**警告：全局正则表达式有可变状态**

```typescript
const regex = /foo/g
regex.test('foo')  // true, lastIndex = 3
regex.test('foo')  // false, lastIndex = 0
```

全局正则（`/g`）有可变的 `lastIndex` 状态：

### 7.10 求最值用循环而非排序

**影响程度：低（O(n) 而非 O(n log n)）**

查找最小或最大元素只需一次遍历数组。排序是浪费且更慢的。

**错误做法（O(n log n) — 为查找最新而排序）：**

```typescript
interface Project {
  id: string
  name: string
  updatedAt: number
}

function getLatestProject(projects: Project[]) {
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)
  return sorted[0]
}
```

为了找最大值而对整个数组排序。

**错误做法（O(n log n) — 排序获取最早和最新）：**

```typescript
function getOldestAndNewest(projects: Project[]) {
  const sorted = [...projects].sort((a, b) => a.updatedAt - b.updatedAt)
  return { oldest: sorted[0], newest: sorted[sorted.length - 1] }
}
```

在只需要最值时仍然做不必要的排序。

**正确做法（O(n) — 单次循环）：**

```typescript
function getLatestProject(projects: Project[]) {
  if (projects.length === 0) return null

  let latest = projects[0]

  for (let i = 1; i < projects.length; i++) {
    if (projects[i].updatedAt > latest.updatedAt) {
      latest = projects[i]
    }
  }

  return latest
}

function getOldestAndNewest(projects: Project[]) {
  if (projects.length === 0) return { oldest: null, newest: null }

  let oldest = projects[0]
  let newest = projects[0]

  for (let i = 1; i < projects.length; i++) {
    if (projects[i].updatedAt < oldest.updatedAt) oldest = projects[i]
    if (projects[i].updatedAt > newest.updatedAt) newest = projects[i]
  }

  return { oldest, newest }
}
```

单次遍历数组，无拷贝，无排序。

**小数组的替代方案：Math.min/Math.max**

```typescript
const numbers = [5, 2, 8, 1, 9]
const min = Math.min(...numbers)
const max = Math.max(...numbers)
```

这适用于小数组，但由于展开运算符的限制，对非常大的数组可能更慢或抛出错误。最大数组长度大约在 Chrome 143 中为 124000，Safari 18 中为 638000；确切数值可能不同 — 参见 [the fiddle](https://jsfiddle.net/qw1jabsx/4/)。为保证可靠性，对大型数组使用循环方法。

### 7.11 使用 Set/Map 实现 O(1) 查找

**影响程度：低中（O(n) 到 O(1)）**

将数组转换为 Set/Map 以进行重复的成员检查。

**错误做法（每次检查 O(n)）：**

```typescript
const allowedIds = ['a', 'b', 'c', ...]
items.filter(item => allowedIds.includes(item.id))
```

**正确做法（每次检查 O(1)）：**

```typescript
const allowedIds = new Set(['a', 'b', 'c', ...])
items.filter(item => allowedIds.has(item.id))
```

### 7.12 为不可变性使用 toSorted() 而非 sort()

**影响程度：中高（防止 React state 中的变更 bug）**

`.sort()` 在原位改变数组，可能导致 React state 和属性的 bug。使用 `.toSorted()` 创建一个新的已排序数组而不改变原数组。

**错误做法：改变了原始数组**

```typescript
function UserList({ users }: { users: User[] }) {
  // 改变了 users 属性数组！
  const sorted = useMemo(
    () => users.sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  )
  return <div>{sorted.map(renderUser)}</div>
}
```

**正确做法：创建新数组**

```typescript
function UserList({ users }: { users: User[] }) {
  // 创建新的已排序数组，原始数组不变
  const sorted = useMemo(
    () => users.toSorted((a, b) => a.name.localeCompare(b.name)),
    [users]
  )
  return <div>{sorted.map(renderUser)}</div>
}
```

**为什么这在 React 中很重要：**

1. 属性/state 的变更破坏 React 的不可变模型 — React 期望属性和 state 被视为只读
2. 导致过期闭包 bug — 在闭包（回调、effect）中修改数组可能导致意外行为

**旧浏览器的回退：**

```typescript
// 旧浏览器回退
const sorted = [...items].sort((a, b) => a.value - b.value)
```

`.toSorted()` 在所有现代浏览器中可用（Chrome 110+、Safari 16+、Firefox 115+、Node.js 20+）。对于旧环境，使用展开运算符：

**其他不可变数组方法：**

- `.toSorted()` — 不可变排序
- `.toReversed()` — 不可变反转
- `.toSpliced()` — 不可变拼接
- `.with()` — 不可变元素替换

---

## 8. 高级模式

**影响程度：低**

需要谨慎实现的特定场景的高级模式。

### 8.1 只初始化一次应用，不要每次挂载都初始化

**影响程度：低中（避免开发中的重复初始化）**

不要将必须在每次应用加载时运行一次的应用级初始化放在组件的 `useEffect([])` 中。组件可能会重新挂载，effect 会重新运行。使用模块级守卫或入口模块中的顶层初始化代替。

**错误做法：在开发中运行两次，重新挂载时重新运行**

```tsx
function Comp() {
  useEffect(() => {
    loadFromStorage()
    checkAuthToken()
  }, [])

  // ...
}
```

**正确做法：每次应用加载只运行一次**

```tsx
let didInit = false

function Comp() {
  useEffect(() => {
    if (didInit) return
    didInit = true
    loadFromStorage()
    checkAuthToken()
  }, [])

  // ...
}
```

参考：[https://react.dev/learn/you-might-not-need-an-effect#initializing-the-application](https://react.dev/learn/you-might-not-need-an-effect#initializing-the-application)

### 8.2 事件处理器存储在 ref 中

**影响程度：低（稳定的订阅）**

当事件处理器在不需要因回调变化而重新订阅的 effect 中使用时，将它们存储在 ref 中。

**错误做法：每次渲染都重新订阅**

```tsx
function useWindowEvent(event: string, handler: (e) => void) {
  useEffect(() => {
    window.addEventListener(event, handler)
    return () => window.removeEventListener(event, handler)
  }, [event, handler])
}
```

**正确做法：稳定的订阅**

```tsx
import { useEffectEvent } from 'react'

function useWindowEvent(event: string, handler: (e) => void) {
  const onEvent = useEffectEvent(handler)

  useEffect(() => {
    window.addEventListener(event, onEvent)
    return () => window.removeEventListener(event, onEvent)
  }, [event])
}
```

**替代方案：如果你使用最新版 React，可以使用 `useEffectEvent`：**

`useEffectEvent` 为同一模式提供了更清晰的 API：它创建一个稳定的函数引用，始终调用最新版本的处理器。

### 8.3 useEffectEvent 用于稳定的回调引用

**影响程度：低（防止 effect 重运行）**

在不将它们添加到依赖数组的情况下访问回调中的最新值。防止 effect 重运行，同时避免过期闭包。

**错误做法：每次回调变化时 effect 都重运行**

```tsx
function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => onSearch(query), 300)
    return () => clearTimeout(timeout)
  }, [query, onSearch])
}
```

**正确做法：使用 React 的 useEffectEvent**

```tsx
import { useEffectEvent } from 'react';

function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('')
  const onSearchEvent = useEffectEvent(onSearch)

  useEffect(() => {
    const timeout = setTimeout(() => onSearchEvent(query), 300)
    return () => clearTimeout(timeout)
  }, [query])
}
```

---

## 参考链接

1. [https://react.dev](https://react.dev)
2. [https://nextjs.org](https://nextjs.org)
3. [https://swr.vercel.app](https://swr.vercel.app)
4. [https://github.com/shuding/better-all](https://github.com/shuding/better-all)
5. [https://github.com/isaacs/node-lru-cache](https://github.com/isaacs/node-lru-cache)
6. [https://vercel.com/blog/how-we-optimized-package-imports-in-next-js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)
7. [https://vercel.com/blog/how-we-made-the-vercel-dashboard-twice-as-fast](https://vercel.com/blog/how-we-made-the-vercel-dashboard-twice-as-fast)
