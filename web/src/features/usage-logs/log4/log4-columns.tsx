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
 * Column definitions for the Log4 view — a flat, OpenRouter-style request
 * table: time, channel, token (app), model, input/output tokens, cost,
 * stream speed and duration. Cells reuse the common-logs cell components.
 */
import type { ColumnDef } from '@tanstack/react-table'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { formatTimestampToDate } from '@/lib/format'

import { LogCostDisplay } from '../components/log-cost-display'
import { ModelBadge } from '../components/model-badge'
import {
  TimingMetricsCell,
  StreamTpsCell,
} from '../components/timing-metrics-cell'
import type { UsageLog } from '../data/schema'
import { formatModelName, parseLogOther } from '../lib/format'
import {
  getLogTypeConfig,
  isDisplayableLogType,
  isTimingLogType,
} from '../lib/utils'

/**
 * Build the Log4 column set.
 *
 * @param isAdmin - Admin view renders the channel column; regular users get
 *   no channel data from the backend, so the column is omitted for them.
 * @returns TanStack table column definitions for UsageLog rows
 */
export function useLog4Columns(isAdmin: boolean): ColumnDef<UsageLog>[] {
  const { t } = useTranslation()

  const columns: ColumnDef<UsageLog>[] = [
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) => {
        const log = row.original
        const timestamp = row.getValue('created_at') as number
        const config = getLogTypeConfig(log.type)

        return (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate font-mono text-xs tabular-nums'>
              {formatTimestampToDate(timestamp)}
            </span>
            <StatusBadge
              label={t(config.label)}
              variant={config.color as StatusBadgeProps['variant']}
              size='sm'
              copyable={false}
              className='-ml-1.5 !text-xs [&_span]:!text-xs'
            />
          </div>
        )
      },
      enableHiding: false,
      size: 180,
    },
  ]

  if (isAdmin) {
    columns.push({
      id: 'channel',
      header: t('Channel'),
      accessorFn: (row) => row.channel,
      cell: ({ row }) => {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        return (
          <div className='flex max-w-[160px] flex-col gap-0.5'>
            <StatusBadge
              label={`#${log.channel}`}
              autoColor={String(log.channel)}
              copyText={String(log.channel)}
              size='sm'
              showDot={false}
              className='w-fit font-mono'
            />
            {log.channel_name ? (
              <span className='text-muted-foreground/70 truncate [font-family:var(--font-body)] !text-xs'>
                {log.channel_name}
              </span>
            ) : null}
          </div>
        )
      },
      size: 150,
    })
  }

  columns.push(
    {
      accessorKey: 'token_name',
      header: t('Token'),
      cell: function TokenNameCell({ row }) {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const other = parseLogOther(log.other)
        const group = log.group || other?.group || ''
        if (!log.token_name) return null

        return (
          <div className='flex max-w-[200px] flex-col gap-0.5'>
            <StatusBadge
              label={log.token_name}
              icon={KeyRound}
              copyText={log.token_name}
              size='sm'
              showDot={false}
              className='border-border/60 bg-muted/30 text-foreground h-6 max-w-full gap-1.5 overflow-hidden rounded-md border px-2 py-0.5 [font-family:var(--font-body)]'
            />
            {group ? (
              <GroupBadge
                group={group}
                type='text'
                size='sm'
                className='inline align-baseline text-xs leading-none [&>span]:leading-none'
              />
            ) : null}
          </div>
        )
      },
      size: 160,
    },
    {
      accessorKey: 'model_name',
      header: t('Model'),
      cell: ({ row }) => {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const modelInfo = formatModelName(log)

        return (
          <div className='flex w-fit flex-col gap-0.5'>
            <ModelBadge
              modelName={modelInfo.name}
              actualModel={modelInfo.actualModel}
            />
          </div>
        )
      },
    },
    {
      accessorKey: 'prompt_tokens',
      header: t('Input'),
      cell: ({ row }) => {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const promptTokens = log.prompt_tokens || 0
        const other = parseLogOther(log.other)
        const cacheReadTokens = other?.cache_tokens || 0
        const cacheWrite5m = other?.cache_creation_tokens_5m || 0
        const cacheWrite1h = other?.cache_creation_tokens_1h || 0
        const hasSplitCache = cacheWrite5m > 0 || cacheWrite1h > 0
        const cacheWriteTokens = hasSplitCache
          ? cacheWrite5m + cacheWrite1h
          : other?.cache_creation_tokens || 0

        return (
          <div className='flex flex-col gap-0.5'>
            <span className='font-mono text-xs font-medium tabular-nums'>
              {promptTokens.toLocaleString()}{' '}
              <span className='text-muted-foreground/60'>tok</span>
            </span>
            {(cacheReadTokens > 0 || cacheWriteTokens > 0) && (
              <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]'>
                {cacheReadTokens > 0 && (
                  <span className='text-muted-foreground/60 whitespace-nowrap'>
                    {t('Cache Read')} {cacheReadTokens.toLocaleString()}
                  </span>
                )}
                {cacheWriteTokens > 0 && (
                  <span className='text-muted-foreground/60 whitespace-nowrap'>
                    {t('Cache Write')} {cacheWriteTokens.toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'completion_tokens',
      header: t('Output'),
      cell: ({ row }) => {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const completionTokens = log.completion_tokens || 0

        return (
          <span className='font-mono text-xs font-medium tabular-nums'>
            {completionTokens.toLocaleString()}{' '}
            <span className='text-muted-foreground/60'>tok</span>
          </span>
        )
      },
    },
    {
      accessorKey: 'quota',
      header: t('Cost'),
      cell: ({ row }) => {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const quota = row.getValue('quota') as number
        const other = parseLogOther(log.other)
        return <LogCostDisplay quota={quota} other={other} />
      },
    },
    {
      id: 'speed',
      header: t('Speed'),
      cell: ({ row }) => {
        const log = row.original
        if (!isTimingLogType(log.type)) return null

        const useTime = log.use_time
        const other = parseLogOther(log.other)
        const tokensPerSecond =
          useTime > 0 && log.completion_tokens > 0
            ? log.completion_tokens / useTime
            : null

        return (
          <StreamTpsCell
            isStream={log.is_stream}
            isTask={other?.is_task === true}
            tokensPerSecond={tokensPerSecond}
            streamStatus={other?.stream_status}
          />
        )
      },
      meta: { label: t('Speed') },
    },
    {
      accessorKey: 'use_time',
      header: t('Timing'),
      cell: ({ row }) => {
        const log = row.original
        if (!isTimingLogType(log.type)) return null

        const useTime = row.getValue('use_time') as number
        const other = parseLogOther(log.other)

        return (
          <TimingMetricsCell
            useTimeSec={useTime}
            completionTokens={log.completion_tokens}
            frtMs={other?.frt}
            isStream={log.is_stream}
          />
        )
      },
    }
  )

  return columns
}
