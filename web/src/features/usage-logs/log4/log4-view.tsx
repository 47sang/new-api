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
/**
 * Log4 view: OpenRouter-style request log list with infinite scrolling.
 *
 * Filter state lives in the URL search params (type/model/range). The URL
 * deliberately carries no absolute timestamps: the queried time window is
 * re-frozen at "now" whenever a filter or the refresh nonce changes, and
 * stays frozen between those changes so offset pagination cannot drift while
 * the user scrolls through pages. Reloading the page therefore always starts
 * from a fresh window instead of a stale snapshot.
 */
import { useIsFetching } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { useLogsViewScope } from '../components/usage-logs-provider'
import {
  LOG4_DEFAULT_TYPE,
  parseLog4TimeRange,
  resolveLog4TimeRange,
  type Log4Filters,
  type Log4TimeRangeId,
} from './lib'
import { Log4FilterBar } from './log4-filter-bar'
import { Log4Table } from './log4-table'

const route = getRouteApi('/_authenticated/usage-logs/$section')

function toSeconds(ms: number | undefined): number | undefined {
  return ms != null ? Math.floor(ms / 1000) : undefined
}

/**
 * Render the Log4 page content (filter bar + infinite-scroll table).
 * Must be mounted inside UsageLogsProvider (uses the shared view scope).
 */
export function Log4View() {
  const search = route.useSearch()
  const navigate = useNavigate()
  const { isAdminView } = useLogsViewScope()
  const [refreshNonce, setRefreshNonce] = useState(0)

  const type = search.type?.[0] ?? LOG4_DEFAULT_TYPE
  const model = search.model ?? ''
  const rangeId = parseLog4TimeRange(search.range)

  const applySearch = (next: {
    type: string
    model: string
    range: Log4TimeRangeId
  }) => {
    void navigate({
      to: '/usage-logs/$section',
      params: { section: 'log4' },
      search: {
        type: [next.type],
        model: next.model || undefined,
        range: next.range,
      },
      replace: true,
    })
  }

  const handleTypeChange = (nextType: string) => {
    applySearch({ type: nextType, model, range: rangeId })
  }

  const handleRangeChange = (nextRange: Log4TimeRangeId) => {
    applySearch({ type, model, range: nextRange })
  }

  const handleModelApply = (nextModel: string) => {
    if (nextModel === model) return
    applySearch({ type, model: nextModel, range: rangeId })
  }

  // Freeze the queried window per filter signature: changing any filter (or
  // refreshing) re-freezes the window at the new "now"; ordinary re-renders
  // (and the pages fetched while scrolling) keep it stable so the backend's
  // offset pagination cannot shift mid-session.
  const filterSignature = [type, model, rangeId, refreshNonce].join('|')
  const frozenFiltersRef = useRef<{
    signature: string
    value: Log4Filters
  } | null>(null)
  if (
    !frozenFiltersRef.current ||
    frozenFiltersRef.current.signature !== filterSignature
  ) {
    const resolved = resolveLog4TimeRange(rangeId)
    frozenFiltersRef.current = {
      signature: filterSignature,
      value: {
        type,
        model,
        startSeconds: toSeconds(resolved.startTime),
        endSeconds:
          toSeconds(resolved.endTime) ?? Math.floor(Date.now() / 1000),
      },
    }
  }
  const filters = frozenFiltersRef.current.value

  const isFetching = useIsFetching({ queryKey: ['usage-logs-log4'] }) > 0

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <Log4FilterBar
        type={type}
        rangeId={rangeId}
        model={model}
        isFetching={isFetching}
        onTypeChange={handleTypeChange}
        onRangeChange={handleRangeChange}
        onModelApply={handleModelApply}
        onRefresh={() => {
          setRefreshNonce((nonce) => nonce + 1)
        }}
      />
      <div className='min-h-0 flex-1'>
        <Log4Table
          isAdmin={isAdminView}
          filters={filters}
          refreshNonce={refreshNonce}
        />
      </div>
    </div>
  )
}
