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
import { Activity, RotateCw } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { USAGE_HEATMAP_LEVEL_CLASSES } from '@/features/dashboard/constants'
import {
  buildHeatmapGrid,
  type HeatmapGrid,
} from '@/features/dashboard/lib'
import type { DailyUsageItem, UsageMetric } from '@/features/dashboard/types'
import { formatCompactNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import dayjs from '@/lib/dayjs'

interface UsageActivityHeatmapProps {
  metric: UsageMetric
  rows: DailyUsageItem[]
  todayStart: number
  locale: Intl.LocalesArgument
  loading: boolean
  error: boolean
  onRetry: () => void
}

const CELL_SIZE = 10
const CELL_GAP = 3
const WEEK_LABEL_ROWS = [
  { id: 'row-mon', label: 'Mon' },
  { id: 'row-tue', label: '' },
  { id: 'row-wed', label: 'Wed' },
  { id: 'row-thu', label: '' },
  { id: 'row-fri', label: 'Fri' },
  { id: 'row-sat', label: '' },
  { id: 'row-sun', label: '' },
]
const MONTH_KEYS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** 按指标格式化格子悬浮数值（与柱状图 tooltip 同口径） */
function formatCellValue(
  value: number,
  metric: UsageMetric,
  locale: Intl.LocalesArgument
): string {
  if (metric === 'spend') return formatQuota(value)
  return formatCompactNumber(value, locale)
}

/** 统计值单元格 */
function StatCell(props: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <div className='text-muted-foreground truncate text-xs'>
        {props.label}
      </div>
      <div className='mt-0.5 truncate text-lg font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

/** Activity 年度热力图（B19-B24）：四个统计值 + GitHub 风格周列格子 + 少/多图例 */
export function UsageActivityHeatmap(props: UsageActivityHeatmapProps) {
  const { t } = useTranslation()

  const grid: HeatmapGrid | null = useMemo(
    () =>
      props.loading
        ? null
        : buildHeatmapGrid(props.rows, props.metric, props.todayStart),
    [props.rows, props.metric, props.todayStart, props.loading]
  )

  const formatDayLabel = (dayTs: number) => dayjs(dayTs * 1000).format('YYYY-MM-DD')

  let body = (
    <div className='p-4 sm:p-5'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <StatCell
          label={t('Longest streak')}
          value={`${grid?.stats.longestStreak ?? 0} ${t('days')}`}
        />
        <StatCell
          label={t('Avg / day')}
          value={formatCellValue(
            grid?.stats.avgDay ?? 0,
            props.metric,
            props.locale
          )}
        />
        <StatCell
          label={t('Avg / week')}
          value={formatCellValue(
            grid?.stats.avgWeek ?? 0,
            props.metric,
            props.locale
          )}
        />
        <StatCell
          label={t('Total')}
          value={formatCellValue(
            grid?.stats.total ?? 0,
            props.metric,
            props.locale
          )}
        />
      </div>

      {grid && (
        <div className='mt-4 overflow-x-auto pb-1'>
          <div
            className='inline-flex min-w-max flex-col gap-1'
            role='group'
            aria-label={t('Daily activity heatmap')}
          >
            {/* 月份标签行：与周列一一对齐 */}
            <div
              className='text-muted-foreground h-4 text-[10px] leading-4'
              aria-hidden='true'
            >
              <div
                className='inline-grid'
                style={{
                  gridTemplateColumns: `repeat(${grid.weekCount}, ${CELL_SIZE + CELL_GAP}px)`,
                }}
              >
                {grid.monthMarks.map((mark) => (
                  <span
                    key={`month-${mark.weekIndex}-${mark.month}`}
                    style={{ gridColumnStart: mark.weekIndex + 1 }}
                    className='whitespace-nowrap'
                  >
                    {t(MONTH_KEYS[mark.month])}
                  </span>
                ))}
              </div>
            </div>

            <div className='flex gap-[3px]'>
              {/* 星期标签列 */}
              <div
                className='text-muted-foreground grid text-[10px] leading-none'
                aria-hidden='true'
                style={{
                  gridTemplateRows: `repeat(7, ${CELL_SIZE}px)`,
                  gap: CELL_GAP,
                }}
              >
                {WEEK_LABEL_ROWS.map((row) => (
                  <span key={row.id} className='h-[10px] leading-[10px]'>
                    {row.label ? t(row.label) : ''}
                  </span>
                ))}
              </div>

              {/* 周列格子 */}
              <div className='flex gap-[3px]'>
                {Array.from({ length: grid.weekCount }, (_, week) => (
                  <div
                    key={`week-${grid.cells[week * 7]?.dayTs ?? week}`}
                    className='grid'
                    style={{
                      gridTemplateRows: `repeat(7, ${CELL_SIZE}px)`,
                      gap: CELL_GAP,
                    }}
                  >
                    {grid.cells
                      .slice(week * 7, week * 7 + 7)
                      .map((cell) => (
                        <div
                          key={cell.dayTs}
                          role='img'
                          title={`${formatDayLabel(cell.dayTs)} ${formatCellValue(cell.value, props.metric, props.locale)}`}
                          className={cn(
                            'size-[10px] rounded-[2px]',
                            USAGE_HEATMAP_LEVEL_CLASSES[cell.level]
                          )}
                          aria-label={`${formatDayLabel(cell.dayTs)} ${formatCellValue(cell.value, props.metric, props.locale)}`}
                        />
                      ))}
                  </div>
                ))}
              </div>
            </div>

            {/* 少 → 多 图例（B20） */}
            <div
              className='text-muted-foreground mt-1 flex items-center gap-1 text-[10px]'
              aria-hidden='true'
            >
              <span>{t('Less')}</span>
              {USAGE_HEATMAP_LEVEL_CLASSES.map((colorClass) => (
                <span
                  key={colorClass}
                  className={cn('size-[10px] rounded-[2px]', colorClass)}
                />
              ))}
              <span>{t('More')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (props.error) {
    body = (
      <div className='text-muted-foreground flex h-40 items-center justify-center text-sm'>
        {t('Failed to load usage data')}
      </div>
    )
  } else if (props.loading || !grid) {
    body = (
      <div className='space-y-4 p-4 sm:p-5'>
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className='h-10' />
          ))}
        </div>
        <Skeleton className='h-28 w-full' />
      </div>
    )
  }

  return (
    <section className='overflow-hidden rounded-lg border'>
      <header className='flex items-center gap-2 border-b px-4 py-2.5 sm:px-5 sm:py-3'>
        <IconBadge tone='info' size='sm'>
          <Activity aria-hidden='true' />
        </IconBadge>
        <div className='text-sm font-semibold'>{t('Activity')}</div>
        {props.error && (
          <Button
            variant='outline'
            size='sm'
            className='ml-auto'
            onClick={props.onRetry}
          >
            <RotateCw className='size-3.5' aria-hidden='true' />
            {t('Retry')}
          </Button>
        )}
      </header>
      {body}
    </section>
  )
}
