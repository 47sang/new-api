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
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { computeModelTokenSplits } from '@/features/dashboard/lib'
import type { DailyUsageItem } from '@/features/dashboard/types'

import { UsageModelCachePanel } from '../usage-model-cache-panel'

const DAY = 86400

function splitRow(
  model: string,
  values: {
    uncached_input_tokens?: number
    cache_read_tokens?: number
    output_tokens?: number
  }
): DailyUsageItem {
  return { created_at: DAY, model_name: model, ...values }
}

function renderPanel(
  rows: DailyUsageItem[],
  metric: 'tokens' | 'spend' | 'requests' = 'tokens'
) {
  return render(
    <UsageModelCachePanel
      ranks={computeModelTokenSplits(rows, 20)}
      metric={metric}
      locale='en-US'
      loading={false}
    />
  )
}

describe('UsageModelCachePanel', () => {
  const rows = [
    splitRow('alpha', {
      uncached_input_tokens: 300,
      cache_read_tokens: 700,
      output_tokens: 200,
    }),
    splitRow('beta', { uncached_input_tokens: 900, cache_read_tokens: 100 }),
    splitRow('gamma', { output_tokens: 50 }),
  ]

  test('渲染标题、口径说明与每模型一行', () => {
    const { container } = renderPanel(rows)

    expect(screen.getByText('Model cache share')).toBeTruthy()
    const header = container.querySelector('section')
    // 口径说明与标题同处一行，文本被拆成多个节点，用整段文本断言
    expect(header?.textContent).toContain('by tokens')
    expect(header?.textContent).toContain(
      'Cache hit rate = cache read / (cache read + uncached input)'
    )
    // 模型名在列表与堆叠条两块各出现一次
    expect(screen.getAllByText('alpha')).toHaveLength(2)
    expect(screen.getAllByText('beta')).toHaveLength(2)
    expect(screen.getAllByText('gamma')).toHaveLength(2)
  })

  test('列表与堆叠条都按三项合计降序排列', () => {
    const { container } = renderPanel(rows)
    // 合计：alpha 1200、beta 1000、gamma 50
    const listItems = container.querySelectorAll('li')
    expect(listItems).toHaveLength(6) // 3 行列表 + 3 条堆叠
    const firstListItem = listItems[0] as HTMLElement
    expect(firstListItem.textContent).toContain('alpha')
    const lastListItem = listItems[5] as HTMLElement
    expect(lastListItem.textContent).toContain('gamma')
  })

  test('堆叠条三段宽度与占比一致', () => {
    const { container } = renderPanel(rows)
    const bars = container.querySelectorAll('[role="presentation"]')
    // 3 条堆叠条
    expect(bars).toHaveLength(3)
    const alphaBar = bars[0] as HTMLElement
    const segments = alphaBar.children
    // alpha: 缓存读 700/1200、非缓存读 300/1200、输出 200/1200
    expect(segments).toHaveLength(3)
    const widths = [...segments].map((segment) =>
      Number.parseFloat((segment as HTMLElement).style.width)
    )
    expect(widths[0]).toBeCloseTo((700 / 1200) * 100)
    expect(widths[1]).toBeCloseTo(25)
    expect(widths[2]).toBeCloseTo((200 / 1200) * 100)
    expect((segments[0] as HTMLElement).style.backgroundColor).toBe(
      'rgb(90, 216, 166)'
    )
    expect((segments[2] as HTMLElement).style.backgroundColor).toBe(
      'rgb(91, 143, 249)'
    )
  })

  test('堆叠条 title 给出三项精确数值与命中率', () => {
    const { container } = renderPanel(rows)
    const bars = container.querySelectorAll('[role="presentation"]')
    const title = (bars[0] as HTMLElement).getAttribute('title') ?? ''
    expect(title).toContain('alpha')
    expect(title).toContain('Cache Read: 700 (58.33%)')
    expect(title).toContain('Uncached Input: 300 (25%)')
    expect(title).toContain('Output: 200 (16.67%)')
    expect(title).toContain('Cache hit rate: 70%')
  })

  test('超出上限的模型合并为「其他」行，命中率按合计重算', () => {
    const many = [
      ...rows,
      splitRow('delta', { cache_read_tokens: 10, uncached_input_tokens: 10 }),
      splitRow('epsilon', { cache_read_tokens: 5, uncached_input_tokens: 15 }),
    ]
    const { container } = render(
      <UsageModelCachePanel
        ranks={computeModelTokenSplits(many, 2)}
        metric='tokens'
        locale='en-US'
        loading={false}
      />
    )
    // 前 2 名 + 其他，两块（列表 + 堆叠条）各一行
    expect(screen.getAllByText('Other')).toHaveLength(2)
    const listItems = container.querySelectorAll('li')
    expect(listItems).toHaveLength(6) // (2 + 其他) × 2 块
    // 其他 = gamma + delta + epsilon：缓存读 15、非缓存读 25、输出 50，
    // 命中率 = 15 / 40 = 37.5%（按合并后的合计重算，不是平均）
    const otherListItem = listItems[2] as HTMLElement
    expect(otherListItem.textContent).toContain('37.5%')
  })

  test('没有拆分数据时显示空状态文案', () => {
    renderPanel([splitRow('legacy', {})])
    expect(
      screen.getByText('No cache breakdown data in the selected range')
    ).toBeTruthy()
  })

  test('指标不是 Token 时整个面板不渲染', () => {
    const { container } = renderPanel(rows, 'spend')
    expect(container.innerHTML).toBe('')
  })

  test('加载中渲染骨架', () => {
    render(
      <UsageModelCachePanel
        ranks={computeModelTokenSplits(rows, 20)}
        metric='tokens'
        locale='en-US'
        loading
      />
    )
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('alpha')).toBeNull()
  })
})
