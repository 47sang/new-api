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
 * Infinite-scroll usage log table for the Log4 view.
 *
 * Pages are fetched with useInfiniteQuery against the offset-paginated log
 * endpoints. Rendering uses the splitHeader DataTableView so the scroll
 * container (with the sticky header and the horizontal scrollbar) sits right
 * around the table; a sentinel rendered via afterTable triggers the next page
 * through a viewport-based IntersectionObserver (ancestor overflow clipping
 * is part of the intersection computation, so the sentinel only fires while
 * it is actually visible inside this container).
 */
import { useInfiniteQuery, useIsFetching } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableRow,
  DataTableView,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import { getAllLogs, getUserLogs } from '../api'
import { LOG_TYPE_ENUM } from '../constants'
import type { UsageLog } from '../data/schema'
import {
  LOG4_PAGE_SIZE,
  buildLog4QueryParams,
  createLog4GetNextPageParam,
  flattenLog4Pages,
  resolveDetailTab,
  type Log4DetailTab,
  type Log4Filters,
  type Log4Page,
} from './lib'
import { useLog4Columns } from './log4-columns'
import { Log4DetailDialog } from './log4-detail-dialog'

const errorRowTint = 'bg-rose-50/40 dark:bg-rose-950/20'

/** Marker class for the inner scroll container owned by DataTableView. */
const SCROLL_BODY_CLASS = 'log4-scroll-body'

// Stable module-level reference: an inline arrow would change identity on
// every render and defeat the row memo for all loaded rows.
const getLog4CellClassName = () => 'py-2'

interface Log4TableProps {
  isAdmin: boolean
  filters: Log4Filters
  /** Bumped to force a reload from the first page. */
  refreshNonce: number
}

/**
 * Render the Log4 infinite-scroll log table.
 *
 * @param props.isAdmin - True uses GET /api/log (all users), false the
 *   /self variant; also controls the channel column.
 * @param props.filters - Type/model filters plus the frozen time window
 * @param props.refreshNonce - Change to drop loaded pages and refetch
 */
export function Log4Table(props: Log4TableProps) {
  const { t } = useTranslation()

  const query = useInfiniteQuery({
    queryKey: [
      'usage-logs-log4',
      props.isAdmin,
      props.filters.type,
      props.filters.model,
      props.filters.startSeconds ?? null,
      props.filters.endSeconds,
      props.refreshNonce,
    ],
    queryFn: async ({ pageParam }) => {
      const params = buildLog4QueryParams({
        page: pageParam,
        pageSize: LOG4_PAGE_SIZE,
        filters: props.filters,
      })
      const result = props.isAdmin
        ? await getAllLogs(params)
        : await getUserLogs(params)
      if (!result?.success) {
        throw new Error(result?.message || t('Failed to load logs'))
      }
      // The shared endpoint type is a union with drawing/task logs; Log4
      // always receives common usage logs here.
      return (result.data ?? {
        items: [],
        total: 0,
        page: pageParam,
        page_size: LOG4_PAGE_SIZE,
      }) as Log4Page
    },
    initialPageParam: 1,
    getNextPageParam: createLog4GetNextPageParam(LOG4_PAGE_SIZE),
  })

  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = query

  const rows = useMemo(() => flattenLog4Pages(data?.pages ?? []), [data?.pages])

  const columns = useLog4Columns(props.isAdmin)

  const { table } = useDataTable<UsageLog>({
    data: rows,
    columns,
    enableRowSelection: false,
    manualPagination: true,
    manualFiltering: true,
    getRowId: (row) => String(row.id),
  })

  const containerRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Cross-render guard: several observer callbacks can fire before
  // isFetchingNextPage propagates through a re-render, and each of them must
  // not enqueue another page fetch.
  const fetchingNextRef = useRef(false)
  const [detailLog, setDetailLog] = useState<UsageLog | null>(null)
  const [detailTab, setDetailTab] = useState<Log4DetailTab>('input')

  // Opening from the Output column jumps straight to the output tab; the
  // clicked cell is found via the data-column-id the table puts on each td.
  const openRowDetail = useCallback(
    (event: React.MouseEvent, log: UsageLog) => {
      const cell = (event.target as HTMLElement).closest('td')
      setDetailTab(
        resolveDetailTab(cell?.getAttribute('data-column-id') ?? null)
      )
      setDetailLog(log)
    },
    []
  )

  // Keyboard parity for the clickable rows (Enter / Space).
  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent, log: UsageLog) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setDetailTab('input')
        setDetailLog(log)
      }
    },
    []
  )

  const tryFetchNextPage = useCallback(() => {
    // While the last fetch failed, retrying is an explicit action (Retry
    // button) — an automatic retry loop against a failing backend would
    // otherwise spin forever whenever the sentinel stays on screen.
    if (isError) return
    if (fetchingNextRef.current) return
    if (hasNextPage && !isFetchingNextPage) {
      fetchingNextRef.current = true
      fetchNextPage()
    }
  }, [isError, hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    if (!isFetchingNextPage) {
      fetchingNextRef.current = false
    }
  }, [isFetchingNextPage])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          tryFetchNextPage()
        }
      },
      { rootMargin: '400px 0px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [tryFetchNextPage])

  // A new filter signature or refresh restarts from page 1 — bring the
  // (recreated) list back to its top so the newest records are in view.
  useEffect(() => {
    const scrollBody = containerRef.current?.querySelector(
      `.${SCROLL_BODY_CLASS}`
    )
    if (scrollBody) {
      scrollBody.scrollTop = 0
    }
  }, [props.filters, props.refreshNonce])

  const isRefreshing = useIsFetching({ queryKey: ['usage-logs-log4'] }) > 0

  const renderLoadStatus = () => {
    if (isError) {
      return (
        <>
          <span>{t('Failed to load logs')}</span>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            {t('Retry')}
          </Button>
        </>
      )
    }
    if (isFetchingNextPage) {
      return (
        <>
          <Spinner className='size-3' />
          <span>{t('Loading')}</span>
        </>
      )
    }
    if (!hasNextPage && rows.length > 0 && !isRefreshing) {
      return (
        <span>{t('All {{count}} records loaded', { count: rows.length })}</span>
      )
    }
    if (hasNextPage) {
      return (
        <Button variant='ghost' size='sm' onClick={tryFetchNextPage}>
          {t('Load more')}
        </Button>
      )
    }
    return null
  }

  return (
    <div ref={containerRef} className='flex h-full min-h-0 flex-col'>
      <DataTableView
        table={table}
        splitHeader
        applyHeaderSize
        containerClassName='min-h-0 flex-1'
        bodyContainerClassName={SCROLL_BODY_CLASS}
        tableHeaderClassName='bg-background'
        tableClassName='[&_[data-slot=table]]:text-[13px] [&_[data-slot=table]_td]:text-[13px] [&_[data-slot=table]_td_*]:text-[13px] [&_[data-slot=table]_th]:text-[13px] [&_[data-slot=table]_th_*]:text-[13px]'
        isLoading={isLoading}
        skeletonKeyPrefix='log4-skeleton'
        emptyTitle={t('No Logs Found')}
        emptyDescription={t(
          'No usage logs available. Logs will appear here once API calls are made.'
        )}
        afterTable={
          <>
            <div
              ref={sentinelRef}
              aria-hidden='true'
              data-testid='log4-scroll-sentinel'
              className='h-px'
            />
            <div
              data-testid='log4-load-status'
              className='text-muted-foreground flex items-center justify-center gap-2 py-3 text-xs'
            >
              {renderLoadStatus()}
            </div>
          </>
        }
        renderRow={(row) => {
          const tintClass =
            row.original.type === LOG_TYPE_ENUM.ERROR ? errorRowTint : ''
          return (
            <DataTableRow
              key={row.id}
              row={row}
              className={cn(
                'hover:bg-muted/40 cursor-pointer transition-colors',
                tintClass
              )}
              onClick={(event) => openRowDetail(event, row.original)}
              onKeyDown={(event) => handleRowKeyDown(event, row.original)}
              tabIndex={0}
              aria-label={t('Open log details')}
              getColumnClassName={getLog4CellClassName}
              cellRenderColumns={table.options.columns}
            />
          )
        }}
      />
      <Log4DetailDialog
        log={detailLog}
        isAdmin={props.isAdmin}
        open={!!detailLog}
        initialTab={detailTab}
        onOpenChange={(open) => {
          if (!open) setDetailLog(null)
        }}
      />
    </div>
  )
}
