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
import { LOG_TYPE_ALL_VALUE } from '../constants'
/**
 * Pure helpers for the Log4 infinite-scroll usage log view.
 *
 * The backend log list endpoints are offset-paginated (p + page_size, capped
 * at 100) with `created_at desc, id desc` ordering, so scrolling pages must
 * freeze the queried time window — otherwise rows inserted between page
 * fetches shift the offset window and duplicate or skip rows.
 */
import type { UsageLog } from '../data/schema'
import type { GetLogsParams } from '../types'

/** Log filters as seen by the table, with the time window already frozen. */
export interface Log4Filters {
  /** LOG_TYPE_FILTERS value ('0' = all types); defaults to consume ('2'). */
  type: string
  model: string
  /** Frozen window start, in seconds (undefined = no lower bound). */
  startSeconds?: number
  /** Frozen window end, in seconds. Always set so offset pagination stays stable. */
  endSeconds: number
}

/** Backend hard cap on page_size (common/page_info.go). */
export const LOG4_PAGE_SIZE = 100

/** Default log type filter: consume logs only. */
export const LOG4_DEFAULT_TYPE = '2'

export const LOG4_DEFAULT_TIME_RANGE = '24h'

export const LOG4_TIME_RANGE_PRESETS = [
  { id: '24h', label: '24 Hours' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 Days' },
  { id: '30d', label: '30 Days' },
  { id: 'all', label: 'All Time' },
] as const

export type Log4TimeRangeId = (typeof LOG4_TIME_RANGE_PRESETS)[number]['id']

const LOG4_TIME_RANGE_DAYS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
}

/**
 * Resolve a time-range preset to a millisecond window.
 *
 * @param id - One of the LOG4_TIME_RANGE_PRESETS ids
 * @param nowMs - Current time in milliseconds; injectable for tests
 * @returns startTime/endTime in ms; both undefined for the 'all' preset
 */
export function resolveLog4TimeRange(
  id: Log4TimeRangeId,
  nowMs = Date.now()
): { startTime?: number; endTime?: number } {
  if (id === 'all') {
    return {}
  }
  if (id === 'today') {
    const start = new Date(nowMs)
    start.setHours(0, 0, 0, 0)
    return { startTime: start.getTime(), endTime: nowMs }
  }
  return {
    startTime: nowMs - LOG4_TIME_RANGE_DAYS[id] * 24 * 60 * 60 * 1000,
    endTime: nowMs,
  }
}

/**
 * Validate a raw search-param value as a time-range preset id.
 *
 * @param value - Raw value from the URL search params
 * @returns The validated preset id, or the default preset when absent/invalid
 */
export function parseLog4TimeRange(value: unknown): Log4TimeRangeId {
  const ids = LOG4_TIME_RANGE_PRESETS.map((preset) => preset.id)
  return typeof value === 'string' && (ids as string[]).includes(value)
    ? (value as Log4TimeRangeId)
    : LOG4_DEFAULT_TIME_RANGE
}

/**
 * Build backend query params for one Log4 page fetch.
 *
 * @param config.page - 1-based page number (backend `p`)
 * @param config.pageSize - Requested page size (backend caps at 100)
 * @param config.filters - Type/model plus the frozen time window
 * @returns Params matching GET /api/log(/self)
 */
export function buildLog4QueryParams(config: {
  page: number
  pageSize: number
  filters: Log4Filters
}): GetLogsParams {
  const { page, pageSize, filters } = config
  const params: GetLogsParams = {
    p: page,
    page_size: pageSize,
    // Backend treats type=0 (LogTypeUnknown) as "no type filter"
    type:
      filters.type !== LOG_TYPE_ALL_VALUE ? Number(filters.type) : undefined,
    ...(filters.model ? { model_name: filters.model } : {}),
    ...(filters.startSeconds != null
      ? { start_timestamp: filters.startSeconds }
      : {}),
    end_timestamp: filters.endSeconds,
  }
  return params
}

/**
 * TanStack Query `getNextPageParam` for the offset-paginated log endpoint.
 * The user-side `total` is capped at 10k by the backend, so "has more" is
 * derived from the returned row count instead of the reported total.
 *
 * @param pageSize - The page size this query requests
 * @returns Callback returning the next page number, or undefined when done
 */
export function createLog4GetNextPageParam(pageSize: number) {
  return (
    lastPage: Log4Page | undefined,
    _allPages: Log4Page[],
    lastPageParam: number
  ): number | undefined => {
    if (!lastPage) return undefined
    return lastPage.items.length >= pageSize ? lastPageParam + 1 : undefined
  }
}

/** Unwrapped shape of the log list endpoint response for common logs. */
export type Log4Page = {
  items: UsageLog[]
  total: number
  page: number
  page_size: number
}

/**
 * Merge loaded pages into a single de-duplicated row list. Rows are keyed by
 * log id (real ids for admins, stable-per-offset synthetic ids for users), so
 * a drifted page can never render the same row twice.
 *
 * @param pages - Loaded pages in fetch order
 * @returns Flattened rows with duplicate ids removed, keeping first occurrence
 */
export function flattenLog4Pages(pages: Log4Page[]): UsageLog[] {
  const seen = new Set<number>()
  const rows: UsageLog[] = []
  for (const page of pages) {
    for (const log of page.items) {
      if (seen.has(log.id)) continue
      seen.add(log.id)
      rows.push(log)
    }
  }
  return rows
}
