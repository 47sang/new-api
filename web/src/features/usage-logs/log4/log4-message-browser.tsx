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
 * Two-pane message browser for the Log4 input tab: a searchable /
 * role-filterable message list on the left and the full content of the
 * selected message (with copy, raw view and prev/next navigation) on the
 * right, following the OpenRouter prompt viewer layout.
 */
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Braces,
  FileText,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

import { messagePreview, type ParsedMessage } from './request-body'
import { RoleBadge } from './role-badge'
import { LOG4_ROLE_META } from './role-meta'

function ToolCallBlock(props: { name: string; arguments: string }) {
  return (
    <div className='bg-muted/30 min-w-0 space-y-1 rounded-md border p-2'>
      <span className='inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-700 dark:text-amber-300'>
        {props.name}
      </span>
      {props.arguments ? (
        // No max-height here: the outer detail pane scrolls, so long
        // arguments fill the remaining space instead of a fixed box.
        <pre className='text-xs leading-relaxed break-all whitespace-pre-wrap'>
          {props.arguments}
        </pre>
      ) : null}
    </div>
  )
}

function ToolResultBlock(props: { id: string; content: string }) {
  return (
    <div className='bg-muted/30 min-w-0 space-y-1 rounded-md border p-2'>
      {props.id ? (
        <span className='text-muted-foreground font-mono text-[11px]'>
          {props.id}
        </span>
      ) : null}
      <pre className='text-xs leading-relaxed break-all whitespace-pre-wrap'>
        {props.content}
      </pre>
    </div>
  )
}

function SelectedMessageContent(props: { message: ParsedMessage }) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const message = props.message
  const [viewRaw, setViewRaw] = useState(false)

  // Precomputed keys keep the map callbacks free of index-based keys.
  const callBlocks = (message.toolCalls ?? []).map((call, position) => ({
    key: `call-${position}-${call.name}`,
    call,
  }))
  const resultBlocks = (message.toolResults ?? []).map((result, position) => ({
    key: `result-${position}-${result.id}`,
    result,
  }))

  // Reset the raw toggle when a different message is selected.
  useEffect(() => {
    setViewRaw(false)
  }, [message])

  const fullText = useMemo(() => {
    const parts = [message.text]
    for (const call of message.toolCalls ?? []) {
      parts.push(`${call.name}: ${call.arguments}`)
    }
    for (const result of message.toolResults ?? []) {
      parts.push(result.content)
    }
    return parts.filter(Boolean).join('\n\n')
  }, [message])

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex shrink-0 flex-wrap items-center gap-1.5 pb-2'>
        <Button
          variant='outline'
          size='sm'
          className='h-7 gap-1.5 px-2 text-xs'
          onClick={() => setViewRaw(!viewRaw)}
        >
          {viewRaw ? (
            <FileText className='size-3.5' />
          ) : (
            <Braces className='size-3.5' />
          )}
          {viewRaw ? t('Formatted') : t('View raw')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          className='h-7 gap-1.5 px-2 text-xs'
          onClick={() => copyToClipboard(fullText)}
        >
          {copiedText === fullText ? (
            <Check className='size-3.5 text-green-600' />
          ) : (
            <Copy className='size-3.5' />
          )}
          {t('Copy')}
        </Button>
      </div>
      <div className='bg-background/40 min-h-0 flex-1 overflow-y-auto rounded-lg border p-3'>
        {viewRaw ? (
          <pre className='text-xs leading-relaxed break-all whitespace-pre-wrap'>
            {JSON.stringify(message.raw, null, 2)}
          </pre>
        ) : (
          <div className='space-y-2'>
            {message.imageCount ? (
              <span className='text-muted-foreground bg-muted inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px]'>
                {t('{{count}} images', { count: message.imageCount })}
              </span>
            ) : null}
            {message.text ? (
              <pre className='text-xs leading-relaxed break-all whitespace-pre-wrap'>
                {message.text}
              </pre>
            ) : null}
            {callBlocks.map((entry) => (
              <ToolCallBlock
                key={entry.key}
                name={entry.call.name}
                arguments={entry.call.arguments}
              />
            ))}
            {resultBlocks.map((entry) => (
              <ToolResultBlock
                key={entry.key}
                id={entry.result.id}
                content={entry.result.content}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Log4MessageBrowser(props: {
  /** Pre-filtered entries (message + original list index), owned by the parent. */
  filtered: Array<{ message: ParsedMessage; index: number }>
  /** Selection position within props.filtered. */
  selectedIndex: number
  onSelect: (position: number) => void
  search: string
  roleFilter: string
  onSearchChange: (value: string) => void
  onRoleFilterChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement | null>(null)

  const filtered = props.filtered
  const safeIndex = filtered.length
    ? Math.min(props.selectedIndex, filtered.length - 1)
    : 0
  const selected = filtered[safeIndex]

  const moveSelection = (delta: number) => {
    const next = Math.min(
      Math.max(safeIndex + delta, 0),
      Math.max(filtered.length - 1, 0)
    )
    props.onSelect(next)
  }

  // Chart-bar clicks can select an off-screen message: bring it into view.
  useEffect(() => {
    const item = listRef.current?.querySelector(
      `[data-position="${safeIndex}"]`
    )
    item?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex])

  return (
    <div className='grid flex-1 gap-3 overflow-y-auto lg:min-h-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:overflow-hidden'>
      {/* Left pane: search + role filter + message list.
          Height management only kicks in on lg+; below that the panes keep
          their natural height and the dialog body scrolls as a page. */}
      <div className='bg-muted/20 flex flex-col rounded-lg border lg:min-h-0 lg:overflow-hidden'>
        <div className='flex shrink-0 items-center gap-2 p-2'>
          <div className='relative min-w-0 flex-1'>
            <Search
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2'
              aria-hidden='true'
            />
            <Input
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder={t('Search messages...')}
              className='h-8 pl-7 text-xs'
              aria-label={t('Search messages...')}
            />
          </div>
          <Select
            value={props.roleFilter}
            onValueChange={(value) => {
              if (value != null) props.onRoleFilterChange(value)
            }}
          >
            <SelectTrigger
              className='h-8 w-28 text-xs'
              aria-label={t('Filter by role')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('All roles')}</SelectItem>
              {Object.entries(LOG4_ROLE_META).map(([role, meta]) => (
                <SelectItem key={role} value={role}>
                  {t(meta.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto'>
          {filtered.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center text-xs'>
              {t('No matching messages')}
            </div>
          ) : (
            filtered.map((entry, position) => {
              const isActive = position === safeIndex
              return (
                <button
                  key={`msg-${entry.index}-${entry.message.role}`}
                  type='button'
                  data-position={position}
                  onClick={() => props.onSelect(position)}
                  className={cn(
                    'flex w-full items-start gap-2 border-b px-2 py-2 text-left last:border-b-0',
                    'transition-colors',
                    isActive
                      ? 'bg-primary/5 border-l-primary border-l-2'
                      : 'hover:bg-muted/40'
                  )}
                >
                  <span className='text-muted-foreground/70 w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] tabular-nums'>
                    {entry.index + 1}
                  </span>
                  {/* OpenRouter-style row: fixed-width role badge on the
                      left, preview text starting right next to it. The
                      preview must not be pre-wrap or line-clamp stops
                      limiting the row height. */}
                  <span className='flex min-w-0 flex-1 items-start gap-2'>
                    <RoleBadge
                      role={entry.message.role}
                      className='w-14 justify-center'
                    />
                    {/* Inline -webkit-line-clamp instead of the Tailwind
                        class: immune to cascade/HMR ordering issues, and
                        pre-wrap must never reappear here or rows grow
                        unbounded. */}
                    <span
                      className='min-w-0 flex-1 text-xs leading-relaxed break-all'
                      style={{
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2,
                        overflow: 'hidden',
                      }}
                    >
                      {messagePreview(entry.message) || '—'}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Right pane: selected message content */}
      <div className='flex flex-col lg:min-h-0 lg:overflow-hidden'>
        <div className='flex shrink-0 items-center justify-end gap-1 pb-2'>
          <Button
            variant='ghost'
            size='sm'
            className='size-7 p-0'
            disabled={safeIndex <= 0}
            onClick={() => moveSelection(-1)}
            aria-label={t('Previous message')}
          >
            <ChevronLeft className='size-4' />
          </Button>
          <span className='text-muted-foreground min-w-24 text-center text-xs tabular-nums'>
            {filtered.length
              ? t('Message {{index}} of {{total}}', {
                  index: safeIndex + 1,
                  total: filtered.length,
                })
              : t('No messages')}
          </span>
          <Button
            variant='ghost'
            size='sm'
            className='size-7 p-0'
            disabled={safeIndex >= filtered.length - 1}
            onClick={() => moveSelection(1)}
            aria-label={t('Next message')}
          >
            <ChevronRight className='size-4' />
          </Button>
        </div>
        <div className='min-h-0 flex-1'>
          {selected ? (
            <SelectedMessageContent message={selected.message} />
          ) : (
            <div className='text-muted-foreground flex h-full items-center justify-center text-xs'>
              {t('No messages')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
