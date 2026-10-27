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
import { useQuery } from '@tanstack/react-query'
/**
 * Log4 detail dialog: an OpenRouter-style request/response viewer opened by
 * clicking a table row. Three tabs — the parsed input prompt (message
 * browser), the parsed output (thinking / tool calls / answer) and the raw
 * stored bodies. Admins fetch by log id; regular users go through the
 * request_id endpoint because the /self list only returns synthetic ids.
 */
import { FileJson, ListTree, MessageSquareText, Repeat } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatTimestampToDate } from '@/lib/format'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  getSelfRequestResponseByRequestId,
  getRequestResponseByLogId,
  getSessionTurns,
} from '../api'
import { JsonBlock } from '../components/json-block'
import type { UsageLog } from '../data/schema'
import { formatJsonBody, parseLogOther } from '../lib/format'
import type { LogOtherData, RequestResponseLog } from '../types'
import type { Log4DetailTab } from './lib'
import { Log4GenerationView } from './log4-generation-view'
import { Log4RequestView } from './log4-request-view'
import { Log4ResponseView } from './log4-response-view'
import {
  isGenerationRequest,
  matchesGenerationRequestPath,
  parseRequestBody,
  parseResponseBody,
} from './request-body'

const LOG4_TABS: Array<{ id: Log4DetailTab; labelKey: string }> = [
  { id: 'input', labelKey: 'Input' },
  { id: 'output', labelKey: 'Output' },
  { id: 'session', labelKey: 'Session' },
  { id: 'raw', labelKey: 'Raw' },
]

/**
 * Detail query outcome: the stored bodies, or the recording-disabled signal.
 * A disabled feature is a state, not a failure, so it travels as data and
 * never rejects the query — a rejection would also raise the global toast.
 */
type Log4DetailQueryData =
  | { status: 'disabled' }
  | { status: 'ready'; data: RequestResponseLog | null }

const REQUEST_RESPONSE_RECORDING_DISABLED =
  'REQUEST_RESPONSE_RECORDING_DISABLED'

/** Raw tab: the stored request/response bodies as pretty-printed JSON. */
function Log4RawView(props: { data: RequestResponseLog }) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const data = props.data

  return (
    <div className='h-full min-h-0 space-y-3 overflow-y-auto pr-1'>
      <div className='flex flex-wrap items-center gap-2'>
        {data.status_code > 0 && (
          <span
            className={cn(
              'font-mono text-sm',
              data.status_code < 400
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            )}
          >
            {t('Status Code')}: {data.status_code}
          </span>
        )}
        {data.is_stream && (
          <span className='text-muted-foreground text-xs'>
            ({t('Streaming')})
          </span>
        )}
        {!data.is_completed && (
          <span className='text-muted-foreground text-xs'>
            ({t('Incomplete')})
          </span>
        )}
      </div>
      {data.request_body ? (
        <JsonBlock
          label={t('Request Body')}
          content={formatJsonBody(data.request_body)}
          copiedText={copiedText}
          copyToClipboard={copyToClipboard}
        />
      ) : (
        <div className='text-muted-foreground text-xs'>
          {t('No request body recorded')}
        </div>
      )}
      {data.response_body ? (
        <JsonBlock
          label={t('Response Body')}
          content={formatJsonBody(data.response_body, data.is_stream)}
          copiedText={copiedText}
          copyToClipboard={copyToClipboard}
        />
      ) : (
        <div className='text-muted-foreground text-xs'>
          {data.is_completed
            ? t('No response body')
            : t('Response body not recorded (binary response or interrupted)')}
        </div>
      )}
      {data.response_size > 0 && (
        <div className='text-muted-foreground text-xs'>
          {t('Response Size')}: {(data.response_size / 1024).toFixed(1)} KB
        </div>
      )}
    </div>
  )
}

function TabButton(props: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'flex items-center gap-1 px-3 py-1.5 text-sm font-medium transition-colors',
        props.active
          ? 'border-b-2 border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {props.icon}
      {props.label}
    </button>
  )
}

function TabIcon(props: { tab: Log4DetailTab }) {
  if (props.tab === 'input') return <MessageSquareText className='size-3.5' />
  if (props.tab === 'output') return <Repeat className='size-3.5' />
  if (props.tab === 'session') return <ListTree className='size-3.5' />
  return <FileJson className='size-3.5' />
}

/**
 * Session tab: every request of one conversation task, oldest first.
 *
 * One agent task issues many requests — the main loop plus parallel
 * sub-agent branches — and the session id the client sends groups them.
 * The first turn usually carries the full history (large prompt token
 * count) while later turns are short branches, which is expected.
 */
function Log4SessionView(props: {
  sessionId: string
  isAdmin: boolean
  currentRequestId: string
  onSelectTurn: (turn: UsageLog) => void
}) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['log4-session', props.isAdmin, props.sessionId],
    queryFn: async () => {
      const result = await getSessionTurns(props.sessionId, props.isAdmin)
      if (!result.success) {
        throw new Error(result.message || t('Failed to load session turns'))
      }
      return result.data
    },
    staleTime: 5 * 60_000,
  })

  if (query.isLoading) {
    return (
      <div className='text-muted-foreground flex h-full items-center justify-center gap-2 text-sm'>
        <Spinner className='size-4' />
        {t('Loading...')}
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <span className='text-sm text-red-600 dark:text-red-400'>
          {query.error instanceof Error
            ? query.error.message
            : t('Failed to load session turns')}
        </span>
        <Button variant='outline' size='sm' onClick={() => query.refetch()}>
          {t('Retry')}
        </Button>
      </div>
    )
  }

  const turns = query.data?.turns ?? []
  if (turns.length === 0) {
    return (
      <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
        {t('No turns recorded for this session')}
      </div>
    )
  }

  return (
    <div className='h-full min-h-0 space-y-2 overflow-y-auto pr-1'>
      <p className='text-muted-foreground text-xs'>
        {t('{{count}} requests in this session', { count: turns.length })}
      </p>
      <ul className='space-y-1'>
        {turns.map((turn, index) => {
          const current = turn.request_id === props.currentRequestId
          return (
            <li key={turn.request_id || turn.id}>
              <button
                type='button'
                onClick={() => props.onSelectTurn(turn)}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'hover:bg-muted flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  current && 'bg-muted'
                )}
              >
                <span className='text-muted-foreground w-8 shrink-0 font-mono text-xs'>
                  #{index + 1}
                </span>
                <span className='w-32 shrink-0 font-mono text-xs'>
                  {formatTimestampToDate(turn.created_at)}
                </span>
                <span className='min-w-0 flex-1 truncate'>
                  {turn.model_name || '—'}
                </span>
                <span className='text-muted-foreground shrink-0 font-mono text-xs'>
                  {(turn.prompt_tokens || 0).toLocaleString()} →{' '}
                  {(turn.completion_tokens || 0).toLocaleString()}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export interface Log4DetailDialogProps {
  log: UsageLog | null
  isAdmin: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tab to show when a log is opened (row-click source column). */
  initialTab?: Log4DetailTab
  /** Switch the dialog to another turn of the same conversation session. */
  onSelectTurn?: (turn: UsageLog) => void
}

/**
 * Render the Log4 row detail dialog.
 *
 * @param props.log - The clicked row, or null when the dialog is closed
 * @param props.isAdmin - True fetches by log id, false by request_id
 * @param props.initialTab - Which tab to open (input by default)
 */
export function Log4DetailDialog(props: Log4DetailDialogProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Log4DetailTab>('input')
  const log = props.log
  const requestId = log?.request_id ?? ''

  useEffect(() => {
    setActiveTab(props.initialTab ?? 'input')
  }, [log?.id, props.initialTab])

  const enabled = props.open && !!log && (props.isAdmin || requestId !== '')
  const query = useQuery({
    queryKey: ['log4-request-response', props.isAdmin, log?.id ?? 0, requestId],
    queryFn: async (): Promise<Log4DetailQueryData | null> => {
      if (!log) return null
      const result = props.isAdmin
        ? await getRequestResponseByLogId(log.id, true)
        : await getSelfRequestResponseByRequestId(requestId)
      if (!result.success) {
        // Recording off is a state, not a failure: answer with the friendly
        // hint instead of throwing (a throw would also raise the global
        // error toast and a pointless retry button).
        if (result.code === REQUEST_RESPONSE_RECORDING_DISABLED) {
          return { status: 'disabled' }
        }
        throw createServerError(
          result,
          t('Failed to load request/response data')
        )
      }
      return { status: 'ready', data: result.data ?? null }
    },
    enabled,
    staleTime: 5 * 60_000,
    // The dialog presents failures itself, so the automatic global error
    // toast would only double up on the in-dialog error state.
    meta: { errorToast: false },
  })

  const queryData = query.data ?? null
  const recordingDisabled = queryData?.status === 'disabled'
  const data = queryData?.status === 'ready' ? queryData.data : null
  const parsedRequest = useMemo(
    () => (data ? parseRequestBody(data.request_body) : null),
    [data]
  )
  const parsedResponse = useMemo(
    () => (data ? parseResponseBody(data.response_body) : null),
    [data]
  )
  const other = useMemo<LogOtherData>(
    () => parseLogOther(log?.other ?? '') ?? ({} as LogOtherData),
    [log?.other]
  )
  // Prompt-style generation requests (image / video) render a dedicated
  // view; the body heuristic alone cannot tell a minimal image request from
  // a legacy completions body, so the recorded request path confirms it.
  const generationRequest =
    parsedRequest &&
    isGenerationRequest(parsedRequest) &&
    matchesGenerationRequestPath(other.request_path)
      ? parsedRequest
      : null
  const chatRequest =
    parsedRequest && !isGenerationRequest(parsedRequest) ? parsedRequest : null

  const noRequestId = !props.isAdmin && requestId === ''
  const hasData = !!data
  const hasSession = !!data?.session_id
  // 打开的请求没有会话标识时不能停在 Session 标签上（该标签会被隐藏）
  const effectiveTab = !hasSession && activeTab === 'session' ? 'input' : activeTab

  const renderTabContent = () => {
    if (noRequestId) {
      return (
        <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
          {t('No request ID is associated with this log')}
        </div>
      )
    }
    if (query.isLoading) {
      return (
        <div className='text-muted-foreground flex h-full items-center justify-center gap-2 text-sm'>
          <Spinner className='size-4' />
          {t('Loading...')}
        </div>
      )
    }
    if (query.isError) {
      return (
        <div className='flex h-full flex-col items-center justify-center gap-3'>
          <span className='text-sm text-red-600 dark:text-red-400'>
            {query.error instanceof Error
              ? query.error.message
              : t('Failed to load request/response data')}
          </span>
          <Button variant='outline' size='sm' onClick={() => query.refetch()}>
            {t('Retry')}
          </Button>
        </div>
      )
    }
    if (recordingDisabled) {
      return (
        <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
          {t(
            'Request/response recording is disabled. Enable it to view the input/output message details.'
          )}
        </div>
      )
    }
    if (!hasData || !log) {
      return (
        <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
          {t('No request/response content recorded for this log')}
        </div>
      )
    }
    if (effectiveTab === 'input') {
      if (generationRequest) {
        return (
          <Log4GenerationView
            request={generationRequest}
            log={log}
            other={other}
          />
        )
      }
      if (!chatRequest) {
        return (
          <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
            <span className='text-muted-foreground text-sm'>
              {t('Unable to parse this request as a chat request.')}
            </span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setActiveTab('raw')}
            >
              {t('View raw')}
            </Button>
          </div>
        )
      }
      return <Log4RequestView request={chatRequest} log={log} other={other} />
    }
    if (effectiveTab === 'output') {
      return (
        <Log4ResponseView
          data={data}
          response={parsedResponse}
          log={log}
          other={other}
        />
      )
    }
    if (effectiveTab === 'session') {
      if (!data.session_id) {
        return (
          <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
            {t('No session is associated with this request')}
          </div>
        )
      }
      return (
        <Log4SessionView
          sessionId={data.session_id}
          isAdmin={props.isAdmin}
          currentRequestId={data.request_id}
          onSelectTurn={(turn) => props.onSelectTurn?.(turn)}
        />
      )
    }
    return <Log4RawView data={data} />
  }

  return (
    <Dialog
      open={props.open && !!log}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <MessageSquareText
            className='text-primary size-4 shrink-0'
            aria-hidden='true'
          />
          {t('Prompt')}
          {chatRequest && (
            <span className='text-muted-foreground text-sm font-normal'>
              ·{' '}
              {t('{{count}} messages', {
                count: chatRequest.messages.length,
              })}{' '}
              · {(log?.prompt_tokens || 0).toLocaleString()} tok
            </span>
          )}
        </>
      }
      description={t('View the request and response content of this log')}
      descriptionClassName='sr-only'
      titleClassName='flex items-center gap-2 text-base'
      // Near-fullscreen dialog: 96% of the viewport in both dimensions.
      // [&>div] lifts the body wrapper's hardcoded max-h so the 96dvh
      // content height is actually honored (the root dialog keeps its own
      // max-h-[calc(100vh-2rem)] guard).
      contentClassName='min-w-0 sm:max-w-[96vw] [&>div]:max-h-none'
      contentHeight='96dvh'
      bodyClassName='h-full'
    >
      <div className='flex h-full min-h-0 flex-col gap-2'>
        {hasData && !noRequestId && (
          <div className='flex shrink-0 items-center gap-1 border-b'>
            {LOG4_TABS.filter(
              (tab) => tab.id !== 'session' || !!data?.session_id
            ).map((tab) => (
              <TabButton
                key={tab.id}
                active={effectiveTab === tab.id}
                icon={<TabIcon tab={tab.id} />}
                label={t(tab.labelKey)}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        )}
        <div className='min-h-0 flex-1'>{renderTabContent()}</div>
      </div>
    </Dialog>
  )
}
