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
 * Input (request) tab of the Log4 detail dialog, mirroring the OpenRouter
 * prompt viewer: a per-message token chart, request stats, a by-role
 * breakdown and a two-pane message browser with search / role filters.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { LogCostDisplay } from '../components/log-cost-display'
import type { UsageLog } from '../data/schema'
import type { LogOtherData } from '../types'
import { Log4MessageBrowser } from './log4-message-browser'
import {
  estimateMessageTokens,
  messagePreview,
  type Log4Role,
  type ParsedRequest,
} from './request-body'
import { RoleBadge } from './role-badge'
import { LOG4_ROLE_META } from './role-meta'

/** One label/value stat line shared by the chat and generation input tabs. */
export function StatRow(props: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='flex items-center justify-between gap-2 text-xs'>
      <span className='text-muted-foreground shrink-0'>{props.label}</span>
      <span className='min-w-0 truncate text-right font-mono tabular-nums'>
        {props.children}
      </span>
    </div>
  )
}

/** Per-message token bars, colored by role; cached messages render grey. */
function TokensPerMessageChart(props: {
  messages: ParsedRequest['messages']
  estimates: number[]
  /** Full-list index of the message selected in the browser below. */
  selectedMessageIndex: number
  /** Clicking a bar selects and scrolls to that message. */
  onBarClick: (messageIndex: number) => void
}) {
  const { t } = useTranslation()
  const max = Math.max(...props.estimates, 1)
  const roles = Object.entries(LOG4_ROLE_META)
  // Precomputed keys/styling keep the map callback free of index-based keys.
  const bars = props.messages.map((message, position) => ({
    key: `bar-${position}-${message.role}`,
    index: position,
    roleLabelKey: LOG4_ROLE_META[message.role].labelKey,
    cached: Boolean(message.cached),
    tokens: props.estimates[position],
    barClass: message.cached
      ? 'bg-slate-400/80'
      : LOG4_ROLE_META[message.role].dotClass,
    height: Math.max(4, Math.round((props.estimates[position] / max) * 100)),
  }))

  return (
    <div className='bg-muted/30 flex min-w-0 flex-col gap-2 rounded-lg border p-3'>
      <span className='text-xs font-semibold'>
        {t('Tokens per message (estimated)')}
      </span>
      {/* Each bar is a full-height button so short messages still have a
          comfortable click target; the colored span inside is purely visual,
          bottom-aligned at the estimated token height. Hovering shows an
          OpenRouter-style tooltip (portal-rendered, so narrow columns never
          clip it). */}
      {/* overflow-hidden keeps hundreds of sub-pixel bars from spilling
          past the card; bars shrink via min-w-0 instead of min-w so the
          chart always fits its grid column. */}
      <TooltipProvider delay={60}>
        <div className='flex h-16 items-stretch gap-px overflow-hidden'>
          {bars.map((bar) => (
            <Tooltip key={bar.key}>
              <TooltipTrigger
                render={
                  <button
                    type='button'
                    aria-label={`#${bar.index + 1} ${t(bar.roleLabelKey)} · ~${bar.tokens} tok`}
                    aria-pressed={props.selectedMessageIndex === bar.index}
                    onClick={() => props.onBarClick(bar.index)}
                    className={cn(
                      'relative flex w-full min-w-0 flex-1 cursor-pointer items-end rounded-sm transition-colors',
                      props.selectedMessageIndex === bar.index
                        ? 'bg-primary/10'
                        : 'hover:bg-muted/40'
                    )}
                  >
                    <span
                      className={cn('w-full rounded-sm', bar.barClass)}
                      style={{ height: `${bar.height}%` }}
                    />
                  </button>
                }
              />
              <TooltipContent className='flex-col items-start gap-0.5'>
                <span className='font-medium'>
                  {t('Message {{index}}', { index: bar.index + 1 })} ·{' '}
                  {t(bar.roleLabelKey)}
                </span>
                <span>
                  {t('~{{count}} tokens (estimated)', { count: bar.tokens })}
                </span>
                {bar.cached ? <span>{t('Cached')}</span> : null}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
        {roles.map(([role, meta]) => (
          <span
            key={role}
            className='text-muted-foreground flex items-center gap-1 text-[11px]'
          >
            <span className={cn('size-2 rounded-full', meta.dotClass)} />
            {t(meta.labelKey)}
          </span>
        ))}
        <span className='text-muted-foreground flex items-center gap-1 text-[11px]'>
          <span className='size-2 rounded-full bg-slate-400/80' />
          {t('Cached')}
        </span>
      </div>
    </div>
  )
}

/** Input tab: stats header + message browser. */
export function Log4RequestView(props: {
  request: ParsedRequest
  log: UsageLog
  other: LogOtherData
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  // Selection position within the FILTERED list; owned here so the chart
  // bars and the message list can drive the same selection.
  const [selectedIndex, setSelectedIndex] = useState(0)

  const messages = props.request.messages
  const estimates = useMemo(
    () => messages.map(estimateMessageTokens),
    [messages]
  )

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return messages
      .map((message, index) => ({ message, index }))
      .filter((entry) => {
        if (roleFilter !== 'all' && entry.message.role !== roleFilter) {
          return false
        }
        if (!keyword) return true
        return messagePreview(entry.message).toLowerCase().includes(keyword)
      })
  }, [messages, search, roleFilter])

  // Reset the selection when filters change; keep it in range otherwise.
  // The skip flag lets a bar click that clears the filters keep its own
  // selection instead of being clobbered by this reset in the same batch.
  const skipSelectionResetRef = useRef(false)
  useEffect(() => {
    if (skipSelectionResetRef.current) {
      skipSelectionResetRef.current = false
      return
    }
    setSelectedIndex(0)
  }, [search, roleFilter])
  const safeIndex = filtered.length
    ? Math.min(selectedIndex, filtered.length - 1)
    : 0
  const selectedMessageIndex = filtered[safeIndex]?.index ?? -1

  const totalEstimated = estimates.reduce((sum, value) => sum + value, 0)
  const promptTokens = props.log.prompt_tokens || 0
  const cacheReadTokens = props.other.cache_tokens || 0
  const cacheWrite5m = props.other.cache_creation_tokens_5m || 0
  const cacheWrite1h = props.other.cache_creation_tokens_1h || 0
  const cacheWriteTokens =
    cacheWrite5m > 0 || cacheWrite1h > 0
      ? cacheWrite5m + cacheWrite1h
      : props.other.cache_creation_tokens || 0

  const roleRows = useMemo(() => {
    const counters = new Map<Log4Role, { count: number; tokens: number }>()
    messages.forEach((message, index) => {
      const entry = counters.get(message.role) ?? { count: 0, tokens: 0 }
      entry.count += 1
      entry.tokens += estimates[index]
      counters.set(message.role, entry)
    })
    return [...counters.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [messages, estimates])

  // Clicking a bar selects that message; when it is hidden by the current
  // filters the filters are cleared first so the target becomes visible.
  const handleBarClick = (messageIndex: number) => {
    let position = filtered.findIndex((entry) => entry.index === messageIndex)
    if (position === -1) {
      skipSelectionResetRef.current = true
      setSearch('')
      setRoleFilter('all')
      position = messageIndex
    }
    setSelectedIndex(position)
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      {/* Stats header: chart + token facts + by-role breakdown */}
      <div className='grid shrink-0 gap-3 lg:grid-cols-[minmax(0,1fr)_15rem_13rem]'>
        <TokensPerMessageChart
          messages={messages}
          estimates={estimates}
          selectedMessageIndex={selectedMessageIndex}
          onBarClick={handleBarClick}
        />
        <div className='bg-muted/30 flex min-w-0 flex-col justify-center gap-1.5 rounded-lg border p-3'>
          <StatRow label={t('Input')}>
            {promptTokens.toLocaleString()} tok
          </StatRow>
          {cacheReadTokens > 0 && (
            <StatRow label={t('Cache Read')}>
              {cacheReadTokens.toLocaleString()}
              {promptTokens > 0 && (
                <span className='text-muted-foreground'>
                  {' '}
                  ({Math.round((cacheReadTokens / promptTokens) * 100)}%)
                </span>
              )}
            </StatRow>
          )}
          {cacheWriteTokens > 0 && (
            <StatRow label={t('Cache Write')}>
              {cacheWriteTokens.toLocaleString()}
            </StatRow>
          )}
          <StatRow label={t('Cost')}>
            <LogCostDisplay quota={props.log.quota} other={props.other} />
          </StatRow>
          <StatRow label={t('Model')}>{props.log.model_name}</StatRow>
        </div>
        <div className='bg-muted/30 flex min-w-0 flex-col justify-center gap-1.5 rounded-lg border p-3'>
          <span className='text-muted-foreground text-xs font-semibold'>
            {t('By role')}
          </span>
          {roleRows.map(([role, entry]) => (
            <div
              key={role}
              className='flex items-center justify-between gap-2 text-xs'
            >
              <RoleBadge role={role} />
              <span className='text-muted-foreground font-mono tabular-nums'>
                {totalEstimated > 0
                  ? `${Math.round((entry.tokens / totalEstimated) * 100)}%`
                  : '-'}
              </span>
              <span className='w-8 shrink-0 text-right font-mono tabular-nums'>
                {entry.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Message browser: list + selected message content */}
      <Log4MessageBrowser
        filtered={filtered}
        selectedIndex={safeIndex}
        onSelect={setSelectedIndex}
        search={search}
        roleFilter={roleFilter}
        onSearchChange={setSearch}
        onRoleFilterChange={setRoleFilter}
      />
    </div>
  )
}
