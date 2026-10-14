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
      onReady?: (instance: unknown) => void
    }) => null
  )
)

type LegendClickHandler = (event: { value?: unknown }) => void

/** 假的 vchart 实例：记录 on/off 绑定，供测试取出图例点击回调 */
function installFakeChart() {
  const handlers = new Map<string, LegendClickHandler[]>()
  const instance = {
    on: (type: string, handler: LegendClickHandler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), handler])
    },
    off: (type: string, handler: LegendClickHandler) => {
      handlers.set(
        type,
        (handlers.get(type) ?? []).filter((bound) => bound !== handler)
      )
    },
  }
  // 把实例交给组件最近一次渲染时传出的 onReady
  chart.mock.calls.at(-1)?.[0].onReady?.(instance)
  return handlers
}
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

function renderChart(
  seriesPoints: DailySeriesPoint[],
  options?: {
    selectedModel?: string | null
    onSelectedModelChange?: (model: string | null) => void
  }
) {
  return render(
    <UsageDailyChart
      series={seriesPoints}
      colorMap={{}}
      metric='tokens'
      loading={false}
      isEmpty={false}
      selectedModel={options?.selectedModel ?? null}
      onSelectedModelChange={options?.onSelectedModelChange}
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

  test('图例单选某个模型时回调该模型名', async () => {
    const onSelectedModelChange = vi.fn()
    renderChart(series([['09-18', 'a', 100]]), { onSelectedModelChange })
    await waitFor(() => expect(chart).toHaveBeenCalled())

    const handlers = installFakeChart()
    const legendHandler = handlers.get('legendItemClick')?.[0]
    expect(typeof legendHandler).toBe('function')

    legendHandler?.({ value: ['b'] })
    expect(onSelectedModelChange).toHaveBeenCalledWith('b')

    // 异常载荷不应抛出，也不应传出非字符串
    legendHandler?.({})
    legendHandler?.({ value: [1, 2] })
    expect(onSelectedModelChange).toHaveBeenCalledTimes(3)
    expect(onSelectedModelChange).toHaveBeenLastCalledWith(null)
  })

  test('vchart 单选图例不会自行取消选中，重复点击同一模型由前端按取消处理', async () => {
    const onSelectedModelChange = vi.fn()
    // 已选中 a：图例再次上报 a 时应取消选中，而不是保持选中
    renderChart(series([['09-18', 'a', 100]]), {
      selectedModel: 'a',
      onSelectedModelChange,
    })
    await waitFor(() => expect(chart).toHaveBeenCalled())

    const legendHandler = installFakeChart().get('legendItemClick')?.[0]
    legendHandler?.({ value: ['a'] })
    expect(onSelectedModelChange).toHaveBeenCalledWith(null)

    // 换选其他模型仍然正常传出
    legendHandler?.({ value: ['b'] })
    expect(onSelectedModelChange).toHaveBeenLastCalledWith('b')
  })

  test('onReady 多次触发（规格更新）时图例监听器只有一个', async () => {
    renderChart(series([['09-18', 'a', 100]]))
    await waitFor(() => expect(chart).toHaveBeenCalled())

    const handlers = installFakeChart()
    installFakeChart() // 模拟规格更新后再次 onReady
    expect(handlers.get('legendItemClick')).toHaveLength(1)
  })
})
