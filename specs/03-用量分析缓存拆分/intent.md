# 意图：用量分析页的模型 Token 缓存拆分

> 作者：zhou。状态：草稿。
> 创建时间：2026-10-13
> 下游产物：[PRODUCT.md]（待生成）

## 问题

用量分析页（`/dashboard/usage`）现在只能看到每个模型的 token 总量，看不出这些 token 花在了哪里：
多少是缓存命中（便宜）、多少是真正的新增输入（贵）、多少是模型输出。我在多个大模型之间分配用量时，
缺一个「这个模型缓存打得满不满、输出占比高不高」的判断依据，只能逐条翻日志估算。

## 预期成果

1. **选中模型看拆分**：在「用量汇总」柱形图上单独选中某个模型（点击图例隔离该模型）后，页面展示该模型
   在所选时间范围内的三类 token——缓存读取、非缓存读取、输出——以及各自占三项合计的百分比，
   一眼看出这个模型的 token 结构。取消选中则恢复原来的 Top models 榜单。
2. **全模型缓存对比**：在 Usage summary 卡内、Top models 榜单下方新增一块「模型缓存占比」，
   两种形态各一块：
   - 列表：每行模型名 + 三项数值 + 合计 + **输入侧缓存命中率**，按合计降序，最多前 20 名，
     其余合并为一行「其他」（三项分别求和）；
   - 图表：每模型一条 100% 三段堆叠横条，横向对比谁缓存打得满。
3. 拆分数据与柱形图**同源同口径**：都来自 `quota_data` 同一批行，OpenAI 语义渠道三项之和等于柱形图的
   token_used（Anthropic 语义渠道的缓存写入未纳入，见约束）。

## 受影响的用户和系统

- **用户角色**：管理员（本页仅 role ≥ 10 可见）。
- **涉及模块**：
  - 后端 `model/usedata.go`（`QuotaData` 结构、内存缓存合并、`increaseQuotaData`、`GetQuotaDataDaily`）、
    `model/log.go`（`RecordConsumeLog` 落 `quota_data` 时补齐三列）、
    `service/text_quota.go`（按 usage 语义算出三项）、`controller/usedata.go`（`/api/data/daily` 返回新字段）
  - 前端 `web/src/features/dashboard/`（用量分析页：柱形图选中态、拆分面板、缓存占比列表与图表）
- **新增模块**：无新路由、无新表；`quota_data` 增加三列。

## 约束

- **数据来源已定：扩展 `quota_data` 表**，不从 `logs` 表现算。由此带来两个已知取舍（已接受）：
  - 升级前写入的历史行三列为 0，**升级后一段时间内 30/90 天窗口的缓存占比为空/0**，要等新数据攒起来；
  - 依赖 `DataExportEnabled` 开启（柱形图本身就依赖它）。
- **不做缓存写入（cache write）**：只展示缓存读 / 非缓存读 / 输出三项。Anthropic 语义渠道的缓存写入
  token 不计入，因此这类模型的三项之和会略小于柱形图的 token_used。
- **三项口径定义**（按 `service/text_quota.go` 既有语义分支，与 `usageDashboardTokenUsed` 保持一致）：
  - 输出 = `completion_tokens`；
  - 缓存读 = `cache_tokens`；
  - 非缓存读 = `prompt_tokens`，但当 prompt 口径**已包含**缓存命中时（非 Anthropic 语义且非 legacy
    Claude 派生）要先减去缓存读，下限 0。
- **累加不能丢数**：`quota_data` 有两条累加路径（`SaveQuotaDataCache` 里的内存缓存合并与
  `increaseQuotaData` 的增量 UPDATE），三列必须同时累加，否则周期刷新会丢拆分数据。
- **不动计费**：本次只加统计列与展示，不触碰 PriceData、结算、表达式与计费口径本身；新列数值沿用既有
  int32 饱和与「不为负」约束（见 `.agents/rules/billing.md`）。
- **数据库兼容**：`quota_data` 在主库，必须同时支持 SQLite / MySQL ≥ 5.7.8 / PostgreSQL ≥ 9.6，
  按 `AGENTS.md` 要求用三库真实实例验证（新建库 + 升级既有库 + 重复启动证明幂等）。
- **不改其他数据看板 Tab**（概览/模型/流向/用户）的行为。

## 参照物

用户提供的用量分析页截图（`127.0.0.1:3000/dashboard/usage`）：汇总大数字 + 环比、按模型堆叠柱形图、
Top models 榜单、Activity 热力图。本需求在该页基础上增加缓存拆分，视觉风格沿用该页既有卡片。

## 已确认决策（2026-10-13）

| 议题 | 结论 |
| --- | --- |
| 数据来源 | 扩展 `quota_data` 表，不从 `logs` 表现算；接受升级前历史为 0 |
| 选中交互 | 柱形图图例点击选中模型 → 汇总卡内右侧由 Top models 切换为该模型的拆分面板，再点一次恢复 |
| 面板位置 | 两块新数据都在 Usage summary 卡内：拆分面板在右侧（替换榜单），全模型缓存在榜单下方 |
| 「缓存占比」口径 | **输入侧缓存命中率** = 缓存读 ÷（缓存读 + 非缓存读），与渠道计费直接相关 |
| 缓存写 | 不做，只展示缓存读 / 非缓存读 / 输出三项 |
| 指标切换 | 切到「消费」/「请求数」时隐藏拆分面板并给出提示文案，不做自动切回 |
| 列表长度 | 前 20 名 + 「其他」合计一行 |
| 三列命名（待你否决） | `uncached_input_tokens` / `cache_read_tokens` / `output_tokens` |

## 待确认问题

- [x] 三列命名 `uncached_input_tokens` / `cache_read_tokens` / `output_tokens` 是否认可？
     不否决就按此实现。
- [x] 100% 堆叠横条图的 tooltip 是否需要展示三项精确数值与命中率（默认：需要）。
