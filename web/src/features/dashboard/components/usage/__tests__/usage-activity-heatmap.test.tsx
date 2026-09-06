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
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { DailyUsageItem } from '@/features/dashboard/types'

import { UsageActivityHeatmap } from '../usage-activity-heatmap'

const DAY = 86400
const TODAY = 400 * DAY

function baseProps() {
  return {
    metric: 'tokens' as const,
    rows: [] as DailyUsageItem[],
    todayStart: TODAY,
    tzOffset: 0,
    locale: 'en-US' as Intl.LocalesArgument,
    loading: false,
    error: false,
    onRetry: vi.fn(),
  }
}

describe('UsageActivityHeatmap', () => {
  test('加载中渲染骨架而非热力图', () => {
    const props = baseProps()
    render(<UsageActivityHeatmap {...props} loading />)
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByRole('group')).toBeNull()
  })

  test('加载失败显示错误文案与重试按钮，点击触发 onRetry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const props = baseProps()
    render(<UsageActivityHeatmap {...props} error onRetry={onRetry} />)

    expect(screen.getByText('Failed to load usage data')).toBeTruthy()
    const retry = screen.getByRole('button', { name: 'Retry' })
    await user.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('渲染统计值、周对齐格子与少/多图例', () => {
    const props = baseProps()
    render(<UsageActivityHeatmap {...props} />)

    for (const label of ['Longest streak', 'Avg / day', 'Avg / week', 'Total']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('Less')).toBeTruthy()
    expect(screen.getByText('More')).toBeTruthy()

    // 热力图格子按 aria-label 暴露「日期 数值」，今天格子存在
    const cells = screen.getAllByRole('img')
    expect(cells.length).toBeGreaterThan(364)
    const todayLabel = new Date(TODAY * 1000).toISOString().slice(0, 10)
    expect(
      cells.some((cell) => cell.getAttribute('aria-label')?.startsWith(todayLabel))
    ).toBe(true)
  })

  test('有数据天的格子 aria-label 携带数值', () => {
    const props = baseProps()
    props.rows = [{ created_at: TODAY, token_used: 500 }]
    render(<UsageActivityHeatmap {...props} />)

    const todayLabel = new Date(TODAY * 1000).toISOString().slice(0, 10)
    const cells = screen.getAllByRole('img')
    const todayCell = cells.find((cell) =>
      cell.getAttribute('aria-label')?.startsWith(todayLabel)
    )
    expect(todayCell?.getAttribute('aria-label')).toContain('500')
  })

  test('空数据渲染全空档格子且统计为 0，不报错', () => {
    const props = baseProps()
    render(<UsageActivityHeatmap {...props} />)

    const cells = screen.getAllByRole('img')
    expect(cells.every((cell) => cell.getAttribute('aria-label')?.endsWith('0'))).toBe(
      true
    )
    expect(screen.getByText('0 days')).toBeTruthy()
  })
})
