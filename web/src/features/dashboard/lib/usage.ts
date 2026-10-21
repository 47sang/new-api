/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import dayjs from '@/lib/dayjs'

import type { DailyUsageItem, UsageMetric } from '@/features/dashboard/types'

import { getDashboardChartColors } from './charts'

// ============================================================================
// 用量分析页（管理员）纯聚合/统计函数，全部可独立单测
// ============================================================================

export const USAGE_TOP_MODEL_LIMIT = 10
export const USAGE_SERIES_MODEL_LIMIT = 12
// 全模型缓存占比列表的上限，超出部分合并为「其他」
export const USAGE_CACHE_MODEL_LIMIT = 20
// 热力图周期：近 364 天（52 周），按周一为首列对齐
export const USAGE_HEATMAP_DAYS = 364
// 「其他」长尾合并项的固定灰色，不参与模型色板轮换
export const USAGE_OTHER_COLOR = '#9ca3af'
// token 三段拆分的固定语义色（与柱形图的按模型色板区分开）：
// 缓存读=命中（便宜）、非缓存读=新增输入（贵）、输出=补全
export const USAGE_TOKEN_SPLIT_COLORS = {
  cacheRead: '#5AD8A6',
  uncachedInput: '#F6BD16',
  output: '#5B8FF9',
} as const

const DAY_SECONDS = 86400

/** 读取一行数据在指定指标下的数值（token_used / quota / count） */
export function usageMetricValue(
  row: DailyUsageItem,
  metric: UsageMetric
): number {
  if (metric === 'tokens') return Number(row.token_used) || 0
  if (metric === 'spend') return Number(row.quota) || 0
  return Number(row.count) || 0
}

/** 按指标对一组行求总量 */
export function summarizeMetric(
  rows: DailyUsageItem[],
  metric: UsageMetric
): number {
  return rows.reduce((sum, row) => sum + usageMetricValue(row, metric), 0)
}

export type PeriodChangeKind = 'new' | 'zero' | 'increase' | 'decrease'

export interface PeriodChange {
  kind: PeriodChangeKind
  percent: number
}

/**
 * 环比当前周期与上一等长周期：
 * - 上一周期为 0 且当前 > 0 → 'new'（显示「新增」徽标，不显示假百分比）
 * - 两者均为 0 → 'zero'
 * - 否则返回带符号百分比
 */
export function computePeriodComparison(
  current: number,
  previous: number
): PeriodChange {
  if (previous === 0 && current > 0) return { kind: 'new', percent: 100 }
  if (previous === 0) return { kind: 'zero', percent: 0 }
  const percent = ((current - previous) / previous) * 100
  if (percent > 0) return { kind: 'increase', percent }
  if (percent < 0) return { kind: 'decrease', percent }
  return { kind: 'zero', percent: 0 }
}

export interface UsageModelRank {
  model: string
  value: number
  /** 与榜首数值之比（0-1），榜首为 1 */
  ratio: number
}

/** token 三段拆分的汇总值 */
export interface TokenSplitTotals {
  /** 非缓存读取 */
  uncachedInput: number
  /** 缓存读取 */
  cacheRead: number
  /** 输出 */
  output: number
  /** 三项合计 */
  total: number
  /** 输入侧合计（缓存读 + 非缓存读），命中率的分母 */
  inputTotal: number
  /** 输入侧缓存命中率（百分比）；输入侧为 0 时为 null */
  cacheHitRate: number | null
  /** 三项是否全为 0（升级前历史行、任务类计费） */
  hasSplitData: boolean
}

export interface ModelTokenSplit extends TokenSplitTotals {
  model: string
  /** true 表示超出上限后合并出来的「其他」项 */
  isOther: boolean
}

export interface ModelTokenSplitRanks {
  entries: ModelTokenSplit[]
  /** 超出 limit 的模型合并项，没有则为 null */
  other: ModelTokenSplit | null
}

/** 读取一行数据的三段拆分（缺失字段按 0 处理） */
function tokenSplitOfRow(row: DailyUsageItem) {
  return {
    uncachedInput: Number(row.uncached_input_tokens) || 0,
    cacheRead: Number(row.cached_input_tokens) || 0,
    output: Number(row.output_tokens) || 0,
  }
}

/** 由三项原始值派生合计、输入侧合计与命中率 */
function toTokenSplitTotals(split: {
  uncachedInput: number
  cacheRead: number
  output: number
}): TokenSplitTotals {
  const total = split.uncachedInput + split.cacheRead + split.output
  const inputTotal = split.uncachedInput + split.cacheRead
  return {
    uncachedInput: split.uncachedInput,
    cacheRead: split.cacheRead,
    output: split.output,
    total,
    inputTotal,
    cacheHitRate: inputTotal > 0 ? (split.cacheRead / inputTotal) * 100 : null,
    hasSplitData: total > 0,
  }
}

/**
 * 汇总一个模型的三段拆分；不传 model 时汇总全部模型。
 * 命中率按输入侧口径（缓存读 ÷（缓存读 + 非缓存读））计算，与渠道计费口径一致。
 */
export function sumTokenSplit(
  rows: DailyUsageItem[],
  model?: string
): TokenSplitTotals {
  const totals = { uncachedInput: 0, cacheRead: 0, output: 0 }
  for (const row of rows) {
    if (model !== undefined && (row.model_name || '') !== model) continue
    const split = tokenSplitOfRow(row)
    totals.uncachedInput += split.uncachedInput
    totals.cacheRead += split.cacheRead
    totals.output += split.output
  }
  return toTokenSplitTotals(totals)
}

/**
 * 按三项合计降序求各模型拆分，供全模型缓存占比面板使用：
 * - 过滤掉没有拆分数据的模型（hasSplitData 为 false）
 * - 合计相同时按模型名字典序，保证顺序稳定
 * - 超出 limit 的模型合并为 other（三项分别求和，命中率按合计重算而非平均）
 */
export function computeModelTokenSplits(
  rows: DailyUsageItem[],
  limit: number = USAGE_CACHE_MODEL_LIMIT
): ModelTokenSplitRanks {
  const byModel = new Map<
    string,
    { uncachedInput: number; cacheRead: number; output: number }
  >()
  for (const row of rows) {
    const model = row.model_name || ''
    const current = byModel.get(model) ?? {
      uncachedInput: 0,
      cacheRead: 0,
      output: 0,
    }
    const split = tokenSplitOfRow(row)
    byModel.set(model, {
      uncachedInput: current.uncachedInput + split.uncachedInput,
      cacheRead: current.cacheRead + split.cacheRead,
      output: current.output + split.output,
    })
  }

  const ranked = [...byModel.entries()]
    .map(([model, split]) => ({
      model,
      isOther: false,
      ...toTokenSplitTotals(split),
    }))
    .filter((entry) => entry.hasSplitData)
    .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model))

  const capped = limit > 0 ? ranked.slice(0, limit) : ranked
  const rest = limit > 0 ? ranked.slice(limit) : []
  const restTotals = rest.reduce(
    (totals, entry) => ({
      uncachedInput: totals.uncachedInput + entry.uncachedInput,
      cacheRead: totals.cacheRead + entry.cacheRead,
      output: totals.output + entry.output,
    }),
    { uncachedInput: 0, cacheRead: 0, output: 0 }
  )
  return {
    entries: capped,
    other:
      rest.length > 0
        ? { model: '', isOther: true, ...toTokenSplitTotals(restTotals) }
        : null,
  }
}

/** 三项占三项合计的百分比（0-100）；合计为 0 时三项均为 0 */
export function tokenSplitShares(split: TokenSplitTotals): {
  cacheRead: number
  uncachedInput: number
  output: number
} {
  if (split.total <= 0) return { cacheRead: 0, uncachedInput: 0, output: 0 }
  return {
    cacheRead: (split.cacheRead / split.total) * 100,
    uncachedInput: (split.uncachedInput / split.total) * 100,
    output: (split.output / split.total) * 100,
  }
}

/** 按当前指标求各模型总量并降序取前 limit 名（B15-B17） */
export function computeTopModels(
  rows: DailyUsageItem[],
  metric: UsageMetric,
  limit: number = USAGE_TOP_MODEL_LIMIT
): UsageModelRank[] {
  const totals = sumByModel(rows, metric)
  const sorted = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
  const max = sorted.length > 0 ? sorted[0][1] : 0
  return sorted.map(([model, value]) => ({
    model,
    value,
    ratio: max > 0 ? value / max : 0,
  }))
}

/**
 * 为所有模型分配颜色：按当前指标总量降序取 vchart 默认色板（榜首第一色），
 * 柱状图与 Top models 共用同一 colorMap 以保证同模型同色（B18）。
 * otherLabel 固定使用灰色。
 */
export function buildModelColors(
  rows: DailyUsageItem[],
  metric: UsageMetric,
  otherLabel: string
): Record<string, string> {
  const totals = sumByModel(rows, metric)
  const sortedModels = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([model]) => model)
  const palette = getDashboardChartColors(sortedModels.length + 1)
  const colors: Record<string, string> = {}
  sortedModels.forEach((model, index) => {
    const color = palette[index % palette.length]
    if (typeof color === 'string') colors[model] = color
  })
  colors[otherLabel] = USAGE_OTHER_COLOR
  return colors
}

export interface DailySeriesPoint {
  /** 天标签（本地时区 MM-DD） */
  Day: string
  Model: string
  /** 紧凑展示值（等于原始数值，字段名对齐 vchart yField） */
  Value: number
}

/**
 * 构建按天堆叠柱状图的数据点（B10-B13）：
 * - X 轴从 startDayTs 到 todayStart 每个日历天补齐（无数据天为 0）
 * - 超出 topN 的模型合并进 otherLabel（B12）
 * - dayTs 为真实本地日 0 点（秒，调用方已把后端伪时间戳归一化）
 */
export function buildDailyModelSeries(
  rows: DailyUsageItem[],
  metric: UsageMetric,
  options: {
    startDayTs: number
    todayStart: number
    otherLabel: string
    colorMap: Record<string, string>
    topN?: number
  }
): DailySeriesPoint[] {
  const topN = options.topN ?? USAGE_SERIES_MODEL_LIMIT
  const totals = sumByModel(rows, metric)
  const topModels = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([model]) => model)
  const seriesModels = [...topModels, options.otherLabel]
  const topModelSet = new Set(topModels)

  const valueByKey = new Map<string, number>()
  for (const row of rows) {
    const model = topModelSet.has(row.model_name || '')
      ? (row.model_name || '')
      : options.otherLabel
    const key = `${row.created_at} ${model}`
    valueByKey.set(key, (valueByKey.get(key) || 0) + usageMetricValue(row, metric))
  }

  const points: DailySeriesPoint[] = []
  for (let day = options.startDayTs; day <= options.todayStart; day += DAY_SECONDS) {
    const label = dayjs(day * 1000).format('MM-DD')
    for (const model of seriesModels) {
      points.push({
        Day: label,
        Model: model,
        Value: valueByKey.get(`${day} ${model}`) || 0,
      })
    }
  }
  return points
}

export interface HeatmapLevels {
  thresholds: [number, number, number]
  levelOf: (value: number) => number
}

/**
 * 按「有用量天数的四分位数」把 >0 的数值划为 4 档深浅，0 为空档（B20）。
 * 无活跃数据时所有正值都归第 1 档。
 */
export function computeHeatmapLevels(dailyValues: number[]): HeatmapLevels {
  const active = dailyValues.filter((v) => v > 0).sort((a, b) => a - b)
  const quantile = (q: number): number => {
    if (active.length === 0) return 0
    const pos = (active.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return active[lo] + (active[hi] - active[lo]) * (pos - lo)
  }
  const thresholds: [number, number, number] = [
    quantile(0.25),
    quantile(0.5),
    quantile(0.75),
  ]
  // 无活跃数据时四分位全为 0，正值得兜底归入第 1 档而非最深层
  const noActiveData = active.length === 0
  return {
    thresholds,
    levelOf(value: number): number {
      if (value <= 0) return 0
      if (noActiveData) return 1
      if (value <= thresholds[0]) return 1
      if (value <= thresholds[1]) return 2
      if (value <= thresholds[2]) return 3
      return 4
    },
  }
}

export interface HeatmapStats {
  total: number
  /** 近一年总量 ÷ 365（日历天，B21 口径） */
  avgDay: number
  /** 近一年总量 ÷ 52 */
  avgWeek: number
  /** 最长连续有用量天数（连续日历天每日总量 > 0） */
  longestStreak: number
}

/** 基于热力图周期内按天序排列的每日数值计算四个统计值（B21） */
export function computeHeatmapStats(dailyValues: number[]): HeatmapStats {
  const total = dailyValues.reduce((sum, v) => sum + v, 0)
  let streak = 0
  let longestStreak = 0
  for (const value of dailyValues) {
    if (value > 0) {
      streak += 1
      longestStreak = Math.max(longestStreak, streak)
    } else {
      streak = 0
    }
  }
  return {
    total,
    avgDay: total / 365,
    avgWeek: total / 52,
    longestStreak,
  }
}

export interface HeatmapCell {
  /** 本地日 0 点伪时间戳（秒） */
  dayTs: number
  value: number
  /** 0 = 空档，1-4 = 浅到深 */
  level: number
}

export interface HeatmapGrid {
  /** 按周列优先排列：每连续 7 个为一列（周一到周日） */
  cells: HeatmapCell[]
  weekCount: number
  stats: HeatmapStats
  levels: HeatmapLevels
  /** 月份标签标记：与前一列月份不同的周列 */
  monthMarks: { weekIndex: number; month: number }[]
}

/**
 * 构建近一年（52 周 + 周一对齐补齐）的热力图格子（B19）：
 * - 起点对齐到 startDay 所在周的周一，终点为 todayStart
 * - rows 为 with_models=false 的按天聚合数据，created_at 已归一化为
 *   真实本地日 0 点（秒），星期/月份直接用本地时区取值
 */
export function buildHeatmapGrid(
  rows: DailyUsageItem[],
  metric: UsageMetric,
  todayStart: number
): HeatmapGrid {
  const valueByDay = new Map<number, number>()
  for (const row of rows) {
    valueByDay.set(
      row.created_at,
      (valueByDay.get(row.created_at) || 0) + usageMetricValue(row, metric)
    )
  }

  const startDay = todayStart - USAGE_HEATMAP_DAYS * DAY_SECONDS
  const startWeekday = dayjs(startDay * 1000).day() // 本地星期，0 = 周日
  const mondayOffset = (startWeekday + 6) % 7
  const gridStart = startDay - mondayOffset * DAY_SECONDS
  const dayCount = Math.floor((todayStart - gridStart) / DAY_SECONDS) + 1

  const cells: HeatmapCell[] = []
  const dailyValues: number[] = []
  for (let i = 0; i < dayCount; i++) {
    const dayTs = gridStart + i * DAY_SECONDS
    const value = valueByDay.get(dayTs) || 0
    dailyValues.push(value)
    cells.push({ dayTs, value, level: 0 })
  }

  const levels = computeHeatmapLevels(dailyValues)
  for (const cell of cells) {
    cell.level = levels.levelOf(cell.value)
  }
  const stats = computeHeatmapStats(dailyValues)

  const weekCount = Math.ceil(dayCount / 7)
  const monthMarks: { weekIndex: number; month: number }[] = []
  let lastMonth = -1
  for (let week = 0; week < weekCount; week++) {
    const cell = cells[week * 7]
    if (!cell) break
    const month = dayjs(cell.dayTs * 1000).month()
    if (month !== lastMonth) {
      monthMarks.push({ weekIndex: week, month })
      lastMonth = month
    }
  }

  return { cells, weekCount, stats, levels, monthMarks }
}

function sumByModel(
  rows: DailyUsageItem[],
  metric: UsageMetric
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const model = row.model_name || ''
    totals.set(model, (totals.get(model) || 0) + usageMetricValue(row, metric))
  }
  return totals
}
