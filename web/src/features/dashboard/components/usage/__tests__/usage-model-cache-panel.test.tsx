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

  test('渲染标题、口径说明与每模型一行（不重复展示模型列）', () => {
    const { container } = renderPanel(rows)

    expect(screen.getByText('Model cache share')).toBeTruthy()
    const header = container.querySelector('section')
    // 口径说明与标题同处一行，文本被拆成多个节点，用整段文本断言
    expect(header?.textContent).toContain('by tokens')
    expect(header?.textContent).toContain(
      'Cache hit rate = cache read / (cache read + uncached input)'
    )
    // 每个模型名只出现一次：不再并排展示第二套模型列
    expect(screen.getAllByText('alpha')).toHaveLength(1)
    expect(screen.getAllByText('beta')).toHaveLength(1)
    expect(screen.getAllByText('gamma')).toHaveLength(1)
    expect(container.querySelectorAll('[role="presentation"]')).toHaveLength(0)
  })

  test('列表按三项合计降序排列', () => {
    const { container } = renderPanel(rows)
    // 合计：alpha 1200、beta 1000、gamma 50
    const listItems = container.querySelectorAll('li')
    expect(listItems).toHaveLength(3)
    expect((listItems[0] as HTMLElement).textContent).toContain('alpha')
    expect((listItems[2] as HTMLElement).textContent).toContain('gamma')
  })

  test('每行给出三项数值、合计与命中率', () => {
    const { container } = renderPanel(rows)
    const firstRow = container.querySelector('li') as HTMLElement
    const text = firstRow.textContent ?? ''
    // alpha：缓存读 700、非缓存读 300、输出 200、合计 1.2K、命中率 700/1000
    expect(text).toContain('700')
    expect(text).toContain('300')
    expect(text).toContain('200')
    expect(text).toContain('1.2K')
    expect(text).toContain('70%')
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
    // 前 2 名 + 其他，合并为同一个列表
    expect(screen.getAllByText('Other')).toHaveLength(1)
    const listItems = container.querySelectorAll('li')
    expect(listItems).toHaveLength(3)
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
