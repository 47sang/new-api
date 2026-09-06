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

import { UsageTopModels } from '../usage-top-models'

function baseProps() {
  return {
    models: [] as { model: string; value: number; ratio: number }[],
    colorMap: { alpha: '#111111', beta: '#222222' },
    metric: 'requests' as const,
    locale: 'en-US' as Intl.LocalesArgument,
    loading: false,
  }
}

describe('UsageTopModels', () => {
  test('渲染标题、排序依据与按比值递减的进度条', () => {
    const props = baseProps()
    props.models = [
      { model: 'alpha', value: 100, ratio: 1 },
      { model: 'beta', value: 50, ratio: 0.5 },
    ]
    const { container } = render(<UsageTopModels {...props} />)

    expect(screen.getByText('Top models')).toBeTruthy()
    expect(screen.getByText('by requests')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()

    const bars = container.querySelectorAll('[style*="width"]')
    expect(bars).toHaveLength(2)
    expect((bars[0] as HTMLElement).style.width).toBe('100%')
    expect((bars[1] as HTMLElement).style.width).toBe('50%')
    // 颜色与柱状图共用 colorMap
    expect((bars[0] as HTMLElement).style.backgroundColor).toBe('rgb(17, 17, 17)')
  })

  test('空数据显示空状态文案', () => {
    const props = baseProps()
    props.models = []
    render(<UsageTopModels {...props} />)

    expect(screen.getByText('No usage data in the selected range')).toBeTruthy()
  })

  test('加载中渲染骨架', () => {
    const props = baseProps()
    props.models = []
    render(<UsageTopModels {...props} loading />)

    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('No usage data in the selected range')).toBeNull()
  })
})
