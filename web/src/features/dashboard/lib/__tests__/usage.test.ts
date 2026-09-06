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
import { describe, expect, test } from 'vitest'
import dayjs from '@/lib/dayjs'

import type { DailyUsageItem } from '@/features/dashboard/types'

import {
  USAGE_HEATMAP_DAYS,
  buildDailyModelSeries,
  buildHeatmapGrid,
  buildModelColors,
  computeHeatmapLevels,
  computeHeatmapStats,
  computePeriodComparison,
  computeTopModels,
  summarizeMetric,
  usageMetricValue,
} from '../usage'

const DAY = 86400

function row(
  dayTs: number,
  model: string,
  values: { count?: number; quota?: number; token_used?: number }
): DailyUsageItem {
  return { created_at: dayTs, model_name: model, ...values }
}

describe('usageMetricValue / summarizeMetric', () => {
  test('按指标读取对应字段，缺失字段视为 0', () => {
    const item = row(DAY, 'm', { count: 3, quota: 7, token_used: 100 })
    expect(usageMetricValue(item, 'requests')).toBe(3)
    expect(usageMetricValue(item, 'spend')).toBe(7)
    expect(usageMetricValue(item, 'tokens')).toBe(100)
    expect(usageMetricValue({ created_at: DAY }, 'tokens')).toBe(0)
  })

  test('summarizeMetric 对整组数据求和', () => {
    const rows = [
      row(DAY, 'a', { count: 1 }),
      row(DAY, 'b', { count: 2 }),
      row(2 * DAY, 'a', { count: 4 }),
    ]
    expect(summarizeMetric(rows, 'requests')).toBe(7)
    expect(summarizeMetric([], 'requests')).toBe(0)
  })
})

describe('computePeriodComparison', () => {
  test('上涨返回 increase 与带符号百分比', () => {
    const change = computePeriodComparison(150, 100)
    expect(change.kind).toBe('increase')
    expect(change.percent).toBeCloseTo(50)
  })

  test('下降返回 decrease', () => {
    const change = computePeriodComparison(40, 100)
    expect(change.kind).toBe('decrease')
    expect(change.percent).toBeCloseTo(-60)
  })

  test('上一周期为 0 且当前有值时返回 new，避免假百分比', () => {
    expect(computePeriodComparison(10, 0).kind).toBe('new')
  })

  test('两个周期均为 0 时返回 zero', () => {
    const change = computePeriodComparison(0, 0)
    expect(change.kind).toBe('zero')
    expect(change.percent).toBe(0)
  })
})

describe('computeTopModels', () => {
  test('按指标降序排列并计算与榜首的比值', () => {
    const rows = [
      row(DAY, 'a', { count: 10 }),
      row(DAY, 'b', { count: 5 }),
      row(DAY, 'c', { count: 1 }),
    ]
    const ranks = computeTopModels(rows, 'requests')
    expect(ranks.map((r) => r.model)).toEqual(['a', 'b', 'c'])
    expect(ranks[0].ratio).toBe(1)
    expect(ranks.at(1)?.ratio).toBeCloseTo(0.5)
  })

  test('limit 截断榜单且空数据返回空数组', () => {
    const rows = [
      row(DAY, 'a', { count: 10 }),
      row(DAY, 'b', { count: 5 }),
    ]
    expect(computeTopModels(rows, 'requests', 1)).toHaveLength(1)
    expect(computeTopModels([], 'requests')).toEqual([])
  })
})

describe('buildModelColors', () => {
  test('按总量降序取色且 Other 固定灰色', () => {
    const rows = [
      row(DAY, 'big', { count: 10 }),
      row(DAY, 'small', { count: 1 }),
    ]
    const colors = buildModelColors(rows, 'requests', 'Other')
    const bigColor = colors['big']
    const smallColor = colors['small']
    expect(bigColor).toBeTruthy()
    expect(smallColor).toBeTruthy()
    expect(bigColor).not.toBe(smallColor)
    expect(colors['Other']).toBe('#9ca3af')
  })
})

describe('buildDailyModelSeries', () => {
  test('补齐无数据天为 0，保持日轴连续', () => {
    const points = buildDailyModelSeries(
      [row(DAY, 'a', { count: 3 })],
      'requests',
      {
        startDayTs: DAY,
        todayStart: 3 * DAY,
        otherLabel: 'Other',
        colorMap: {},
      }
    )
    // 3 天 × (模型 a + Other)
    expect(points).toHaveLength(6)
    // 仅 DAY 的模型 a 有值，其余 5 个点全为 0
    expect(points.filter((p) => p.Value === 0)).toHaveLength(5)
    expect(points.filter((p) => p.Value === 3)).toHaveLength(1)
  })

  test('超出 topN 的模型合并进 Other', () => {
    const rows = [
      row(DAY, 'm1', { count: 12 }),
      row(DAY, 'm2', { count: 11 }),
      row(DAY, 'tail', { count: 5 }),
    ]
    const points = buildDailyModelSeries(rows, 'requests', {
      startDayTs: DAY,
      todayStart: DAY,
      otherLabel: 'Other',
      colorMap: {},
      topN: 2,
    })
    const other = points.find((p) => p.Model === 'Other')
    expect(other?.Value).toBe(5)
    expect(points.some((p) => p.Model === 'tail')).toBe(false)
  })

  test('同一天多模型各值正确（堆叠明细）', () => {
    const points = buildDailyModelSeries(
      [
        row(DAY, 'a', { count: 3 }),
        row(DAY, 'b', { count: 4 }),
      ],
      'requests',
      {
        startDayTs: DAY,
        todayStart: DAY,
        otherLabel: 'Other',
        colorMap: {},
      }
    )
    expect(points.find((p) => p.Model === 'a')?.Value).toBe(3)
    expect(points.find((p) => p.Model === 'b')?.Value).toBe(4)
    expect(points.find((p) => p.Model === 'Other')?.Value).toBe(0)
  })
})

describe('computeHeatmapLevels', () => {
  test('按有用量天数的四分位划档，0 为空档', () => {
    // 活跃值 1..8 → 分位约 [2.75, 4.5, 6.25]
    const levels = computeHeatmapLevels([1, 2, 3, 4, 5, 6, 7, 8])
    expect(levels.levelOf(0)).toBe(0)
    expect(levels.levelOf(2)).toBe(1)
    expect(levels.levelOf(4)).toBe(2)
    expect(levels.levelOf(6)).toBe(3)
    expect(levels.levelOf(8)).toBe(4)
  })

  test('无活跃数据时正值归第 1 档', () => {
    const levels = computeHeatmapLevels([0, 0, 0])
    expect(levels.levelOf(5)).toBe(1)
    expect(levels.levelOf(0)).toBe(0)
  })
})

describe('computeHeatmapStats', () => {
  test('总量、日均、周均与最长连续天数（含断档）', () => {
    const stats = computeHeatmapStats([1, 2, 0, 4, 5, 6, 0, 0])
    expect(stats.total).toBe(18)
    expect(stats.avgDay).toBeCloseTo(18 / 365)
    expect(stats.avgWeek).toBeCloseTo(18 / 52)
    expect(stats.longestStreak).toBe(3)
  })

  test('全零数据 streak 为 0', () => {
    expect(computeHeatmapStats([0, 0, 0]).longestStreak).toBe(0)
  })
})

describe('buildHeatmapGrid', () => {
  const today = 400 * DAY

  test('起点对齐周一、覆盖到今天、周列为 7 的倍数', () => {
    const grid = buildHeatmapGrid([], 'tokens', today)
    const firstCell = grid.cells.at(0)
    expect(dayjs((firstCell?.dayTs ?? 0) * 1000).day()).toBe(1) // 本地周一
    expect(grid.cells.at(-1)?.dayTs).toBe(today)
    expect(grid.cells.length).toBe(grid.weekCount * 7 - (7 - (grid.cells.length % 7 || 7)))
    expect(grid.cells.length).toBeGreaterThan(USAGE_HEATMAP_DAYS)
  })

  test('按天映射数值与档位，缺失天为空档', () => {
    const grid = buildHeatmapGrid(
      [row(today, '', { token_used: 100 })],
      'tokens',
      today
    )
    const todayCell = grid.cells.find((cell) => cell.dayTs === today)
    expect(todayCell?.value).toBe(100)
    expect(todayCell?.level).toBeGreaterThan(0)
    const emptyCell = grid.cells.find((cell) => cell.dayTs !== today)
    expect(emptyCell?.level).toBe(0)
    expect(grid.stats.total).toBe(100)
  })

  test('归一化后的真实本地日 0 点正确映射到格子', () => {
    const boundary = 500 * DAY
    // 调用方已把后端伪时间戳归一化为真实本地日 0 点（减去 tz_offset）
    const grid = buildHeatmapGrid(
      [row(boundary, '', { token_used: 50 })],
      'tokens',
      boundary
    )
    const cell = grid.cells.find((c) => c.dayTs === boundary)
    expect(cell?.value).toBe(50)
    // 格子整体右移到周一仍覆盖数据日
    expect(grid.cells.length).toBeGreaterThan(USAGE_HEATMAP_DAYS)
  })

  test('生成月份标记且不重复', () => {
    const grid = buildHeatmapGrid([], 'tokens', today)
    const weekIndexes = grid.monthMarks.map((mark) => mark.weekIndex)
    expect(new Set(weekIndexes).size).toBe(weekIndexes.length)
    expect(weekIndexes[0]).toBe(0)
  })

  test('起点对齐到本地时区的周一（真实日 0 点口径）', () => {
    // 用本地时区构造一个确定是周一的「今天」：2026-09-07 是周一
    const monday = dayjs('2026-09-07T00:00:00').unix()
    const grid = buildHeatmapGrid([], 'tokens', monday)
    const firstCell = grid.cells.at(0)
    expect(dayjs((firstCell?.dayTs ?? 0) * 1000).day()).toBe(1) // 本地周一
    expect(grid.cells.at(-1)?.dayTs).toBe(monday)
  })
})
