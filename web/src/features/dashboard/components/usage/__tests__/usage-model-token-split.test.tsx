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
import { describe, expect, test, vi } from 'vitest'

import type { TokenSplitTotals } from '@/features/dashboard/lib'
import type { UsageMetric } from '@/features/dashboard/types'

import { UsageModelTokenSplit } from '../usage-model-token-split'

function split(
  values: Partial<TokenSplitTotals> & {
    uncachedInput?: number
    cacheRead?: number
    output?: number
  }
): TokenSplitTotals {
  const uncachedInput = values.uncachedInput ?? 0
  const cacheRead = values.cacheRead ?? 0
  const output = values.output ?? 0
  const total = uncachedInput + cacheRead + output
  const inputTotal = uncachedInput + cacheRead
  return {
    uncachedInput,
    cacheRead,
    output,
    total,
    inputTotal,
    cacheHitRate: inputTotal > 0 ? (cacheRead / inputTotal) * 100 : null,
    hasSplitData: total > 0,
    ...values,
  }
}

function baseProps() {
  return {
    model: 'gpt-4o',
    split: split({ uncachedInput: 300, cacheRead: 700, output: 200 }),
    metric: 'tokens' as UsageMetric,
    locale: 'en-US' as Intl.LocalesArgument,
    loading: false,
    error: false,
    onRetry: vi.fn(),
    onBack: vi.fn(),
  }
}

describe('UsageModelTokenSplit', () => {
  test('渲染模型名、三项数值与相加为 100% 的占比', () => {
    render(<UsageModelTokenSplit {...baseProps()} />)

    expect(screen.getByText('Token breakdown')).toBeTruthy()
    expect(screen.getByText('gpt-4o')).toBeTruthy()
    expect(screen.getByText('Cache Read')).toBeTruthy()
    expect(screen.getByText('Uncached Input')).toBeTruthy()
    expect(screen.getByText('Output')).toBeTruthy()
    // 300 / 1200 = 25%，700 / 1200 ≈ 58.33%，200 / 1200 ≈ 16.67%
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('58.33%')).toBeTruthy()
    expect(screen.getByText('16.67%')).toBeTruthy()
  })

  test('输入侧缓存命中率按（缓存读 + 非缓存读）为分母计算', () => {
    render(<UsageModelTokenSplit {...baseProps()} />)
    // 700 / 1000
    expect(screen.getByText('70%')).toBeTruthy()
  })

  test('输入侧为 0 时命中率显示占位符而不是 0%', () => {
    const props = baseProps()
    props.split = split({ output: 500 })
    render(<UsageModelTokenSplit {...props} />)

    // 只有输出有量，占比 100%；输入侧为 0 时命中率给占位符
    expect(screen.getByText('100%')).toBeTruthy()
    const hitRateLabel = screen.getByText('Cache hit rate')
    expect(hitRateLabel.nextElementSibling?.textContent).toBe('—')
  })

  test('三项全为 0 时显示空状态，不渲染假占比', () => {
    const props = baseProps()
    props.split = split({})
    render(<UsageModelTokenSplit {...props} />)

    expect(
      screen.getByText('No cache breakdown data for this model in the selected range')
    ).toBeTruthy()
    expect(screen.queryByText('Cache Read')).toBeNull()
  })

  test('指标不是 Token 时显示提示文案而不是拆分数字', () => {
    const props = baseProps()
    props.metric = 'spend'
    render(<UsageModelTokenSplit {...props} />)

    expect(
      screen.getByText('Token breakdown is only available for the Token metric')
    ).toBeTruthy()
    expect(screen.queryByText('Uncached Input')).toBeNull()
  })

  test('点击返回榜单按钮触发 onBack', async () => {
    const props = baseProps()
    render(<UsageModelTokenSplit {...props} />)

    screen.getByText('Back to Top models').click()
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })

  test('加载中渲染骨架且不渲染占比', () => {
    const props = baseProps()
    props.loading = true
    render(<UsageModelTokenSplit {...props} />)

    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('Cache Read')).toBeNull()
  })

  test('取数失败显示重试按钮', () => {
    const props = baseProps()
    props.error = true
    render(<UsageModelTokenSplit {...props} />)

    expect(screen.getByText('Failed to load usage data')).toBeTruthy()
    screen.getByText('Retry').click()
    expect(props.onRetry).toHaveBeenCalledTimes(1)
  })
})
