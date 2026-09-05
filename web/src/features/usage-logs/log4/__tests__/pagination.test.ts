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

import { LOG_TYPE_ALL_VALUE } from '../../constants'
import {
  LOG4_PAGE_SIZE,
  buildLog4QueryParams,
  createLog4GetNextPageParam,
  type Log4Filters,
  type Log4Page,
} from '../lib'

const baseFilters: Log4Filters = {
  type: '2',
  model: '',
  startSeconds: 1700000000,
  endSeconds: 1700003600,
}

describe('buildLog4QueryParams', () => {
  test('maps page, page size and frozen time window to API params', () => {
    const params = buildLog4QueryParams({
      page: 3,
      pageSize: LOG4_PAGE_SIZE,
      filters: baseFilters,
    })

    expect(params).toEqual({
      p: 3,
      page_size: 100,
      type: 2,
      start_timestamp: 1700000000,
      end_timestamp: 1700003600,
    })
  })

  test('sends no type filter when the all-types sentinel is selected', () => {
    const params = buildLog4QueryParams({
      page: 1,
      pageSize: LOG4_PAGE_SIZE,
      filters: { ...baseFilters, type: LOG_TYPE_ALL_VALUE },
    })

    expect(params.type).toBeUndefined()
  })

  test('passes the model filter through as model_name', () => {
    const params = buildLog4QueryParams({
      page: 1,
      pageSize: LOG4_PAGE_SIZE,
      filters: { ...baseFilters, model: 'gpt-4o' },
    })

    expect(params.model_name).toBe('gpt-4o')
  })

  test('always sends end_timestamp so the offset window cannot drift', () => {
    const params = buildLog4QueryParams({
      page: 2,
      pageSize: LOG4_PAGE_SIZE,
      filters: {
        type: '0',
        model: '',
        startSeconds: undefined,
        endSeconds: 42,
      },
    })

    expect(params.end_timestamp).toBe(42)
    expect(params.start_timestamp).toBeUndefined()
  })
})

describe('createLog4GetNextPageParam', () => {
  const getNextPageParam = createLog4GetNextPageParam(LOG4_PAGE_SIZE)

  const pageWithItems = (count: number, page = 1): Log4Page =>
    ({
      items: Array.from({ length: count }, (_, i) => ({ id: i + 1 })),
      total: 500,
      page,
      page_size: LOG4_PAGE_SIZE,
    }) as Log4Page

  test('returns the next page number when a full page was returned', () => {
    const fullPage = pageWithItems(LOG4_PAGE_SIZE)
    expect(getNextPageParam(fullPage, [fullPage], 1)).toBe(2)
  })

  test('returns undefined for a partial page, including the 10k-capped total', () => {
    const partialPage = { ...pageWithItems(37, 2), total: 10000 }
    expect(getNextPageParam(partialPage, [partialPage], 2)).toBeUndefined()
  })

  test('returns undefined for an empty page', () => {
    const emptyPage = pageWithItems(0)
    expect(getNextPageParam(emptyPage, [emptyPage], 1)).toBeUndefined()
  })

  test('returns undefined when the last page is missing', () => {
    expect(getNextPageParam(undefined, [], 1)).toBeUndefined()
  })
})
