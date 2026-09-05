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

import type { UsageLog } from '../../data/schema'
import {
  LOG4_DEFAULT_TIME_RANGE,
  flattenLog4Pages,
  parseLog4TimeRange,
  resolveLog4TimeRange,
  type Log4Page,
} from '../lib'

function buildPage(ids: number[], startId = 0): Log4Page {
  return {
    items: ids.map((id) => ({
      id: startId + id,
      user_id: 1,
      created_at: 1700000000 - id,
      type: 2,
      content: '',
      username: 'alice',
      token_name: 'key',
      model_name: 'gpt-4o',
      quota: 10,
      prompt_tokens: 100,
      completion_tokens: 50,
      use_time: 2,
      is_stream: true,
      channel: 7,
      channel_name: '',
      token_id: 1,
      group: 'default',
      ip: '',
      other: '',
      request_id: '',
      upstream_request_id: '',
    })) as UsageLog[],
    total: ids.length,
    page: 1,
    page_size: ids.length,
  }
}

describe('flattenLog4Pages', () => {
  test('concatenates pages in fetch order without duplicates', () => {
    const rows = flattenLog4Pages([buildPage([1, 2, 3]), buildPage([4, 5])])
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
  })

  test('drops rows whose id already appeared on an earlier page', () => {
    const rows = flattenLog4Pages([buildPage([1, 2, 3]), buildPage([3, 4])])
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4])
  })

  test('keeps the first occurrence when a drifted page repeats rows', () => {
    const rows = flattenLog4Pages([
      buildPage([1, 2]),
      buildPage([2, 3]),
      buildPage([3]),
    ])
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3])
  })
})

describe('resolveLog4TimeRange', () => {
  const now = new Date('2026-09-05T12:00:00Z').getTime()

  test('resolves the 24-hour preset to a one-day window ending at now', () => {
    const range = resolveLog4TimeRange('24h', now)
    expect(range.endTime).toBe(now)
    expect(range.startTime).toBe(now - 24 * 60 * 60 * 1000)
  })

  test('resolves the 30-day preset', () => {
    const range = resolveLog4TimeRange('30d', now)
    expect(range.startTime).toBe(now - 30 * 24 * 60 * 60 * 1000)
  })

  test('resolves today to local midnight through now', () => {
    const range = resolveLog4TimeRange('today', now)
    expect(range.endTime).toBe(now)
    const startTime = range.startTime
    if (startTime == null) throw new Error('today preset must set startTime')
    const start = new Date(startTime)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getSeconds()).toBe(0)
  })

  test('resolves the all-time preset to no bounds', () => {
    expect(resolveLog4TimeRange('all', now)).toEqual({})
  })
})

describe('parseLog4TimeRange', () => {
  test('accepts known preset ids', () => {
    expect(parseLog4TimeRange('7d')).toBe('7d')
    expect(parseLog4TimeRange('all')).toBe('all')
  })

  test('falls back to the default preset for absent or invalid values', () => {
    expect(parseLog4TimeRange(undefined)).toBe(LOG4_DEFAULT_TIME_RANGE)
    expect(parseLog4TimeRange('')).toBe(LOG4_DEFAULT_TIME_RANGE)
    expect(parseLog4TimeRange('yesterday')).toBe(LOG4_DEFAULT_TIME_RANGE)
    expect(parseLog4TimeRange(42)).toBe(LOG4_DEFAULT_TIME_RANGE)
  })
})
