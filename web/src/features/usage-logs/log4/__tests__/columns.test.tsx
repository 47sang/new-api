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
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { useLog4Columns } from '../log4-columns'

// @lobehub/icons (via ModelBadge) transitively imports @emoji-mart JSON assets
// that vitest's externalized ESM loader rejects; icons are irrelevant here.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

function columnId(column: ReturnType<typeof useLog4Columns>[number]): string {
  if ('id' in column && column.id) return column.id
  if ('accessorKey' in column) return String(column.accessorKey)
  return ''
}

function headerIds(columns: ReturnType<typeof useLog4Columns>): string[] {
  return columns.map(columnId)
}

describe('useLog4Columns', () => {
  test('renders the OpenRouter-style request columns for regular users', () => {
    const { result } = renderHook(() => useLog4Columns(false))
    const ids = headerIds(result.current)

    expect(ids).toEqual([
      'created_at',
      'token_name',
      'model_name',
      'prompt_tokens',
      'completion_tokens',
      'quota',
      'speed',
      'use_time',
    ])
  })

  test('adds the channel column only for the admin view', () => {
    const { result } = renderHook(() => useLog4Columns(true))
    const ids = headerIds(result.current)

    expect(ids).toContain('channel')
    expect(ids.indexOf('channel')).toBeLessThan(ids.indexOf('token_name'))
    expect(result.current).toHaveLength(9)
  })
})
