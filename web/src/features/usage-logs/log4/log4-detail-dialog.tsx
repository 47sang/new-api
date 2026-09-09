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
import { FileJson, MessageSquareText, Repeat } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

import {
  getSelfRequestResponseByRequestId,
  getRequestResponseByLogId,
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
  { id: 'raw', labelKey: 'Raw' },
]

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
  return <FileJson className='size-3.5' />
}

export interface Log4DetailDialogProps {
  log: UsageLog | null
  isAdmin: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tab to show when a log is opened (row-click source column). */
  initialTab?: Log4DetailTab
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
    queryFn: async () => {
      if (!log) return null
      const result = props.isAdmin
        ? await getRequestResponseByLogId(log.id, true)
        : await getSelfRequestResponseByRequestId(requestId)
      if (!result.success) {
        throw new Error(
          result.message || t('Failed to load request/response data')
        )
      }
      return result.data
    },
    enabled,
    staleTime: 5 * 60_000,
  })

  const data = query.data ?? null
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
    if (!hasData || !log) {
      return (
        <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
          {t('No request/response content recorded for this log')}
        </div>
      )
    }
    if (activeTab === 'input') {
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
    if (activeTab === 'output') {
      return (
        <Log4ResponseView
          data={data}
          response={parsedResponse}
          log={log}
          other={other}
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
            {LOG4_TABS.map((tab) => (
              <TabButton
                key={tab.id}
                active={activeTab === tab.id}
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
