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
import { render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { DailySeriesPoint } from '@/features/dashboard/lib'

import { UsageDailyChart } from '../usage-daily-chart'

const chart = vi.hoisted(() =>
  vi.fn(
    (_props: {
      spec: { axes?: { orient: string; min?: number; max?: number }[] }
    }) => null
  )
)
vi.mock('@visactor/react-vchart', () => ({ VChart: chart }))
vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

function series(points: [string, string, number][]): DailySeriesPoint[] {
  return points.map(([day, model, value]) => ({
    Day: day,
    Model: model,
    Value: value,
  }))
}

function renderChart(seriesPoints: DailySeriesPoint[]) {
  return render(
    <UsageDailyChart
      series={seriesPoints}
      colorMap={{}}
      metric='tokens'
      loading={false}
      isEmpty={false}
    />
  )
}

async function renderChartAndCaptureAxis() {
  renderChart(series([['09-18', 'a', 0]]))
  await waitFor(() => expect(chart).toHaveBeenCalled())
  return chart.mock.calls[0][0].spec.axes?.find(
    (axis) => axis.orient === 'left'
  )
}

describe('UsageDailyChart 柱状图顶部预留悬浮空间', () => {
  test('y 轴最大值按最高日堆叠合计除以 0.75 锁定，柱顶预留 25% 高度', async () => {
    renderChart(
      series([
        ['09-18', 'a', 1000],
        ['09-18', 'b', 600],
        ['09-19', 'a', 800],
      ])
    )
    await waitFor(() => expect(chart).toHaveBeenCalled())

    const axis = chart.mock.calls[0][0].spec.axes?.find(
      (item) => item.orient === 'left'
    )
    // 单点最大值只有 1000，必须按堆叠日合计 1600 计算预留空间
    expect(axis?.min).toBe(0)
    expect(axis?.max).toBeCloseTo(1600 / 0.75)
  })

  test('数据全为 0 时不锁定 y 轴最大值，保持自动刻度', async () => {
    const axis = await renderChartAndCaptureAxis()
    expect(axis?.max).toBeUndefined()
  })
})
