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
 * D2 layout for Log4 generation (image / video) rows: request inspection on
 * top with Structured / Messages / JSON modes, and the result (task card,
 * generated images, or upstream video player) below with Preview / JSON modes.
 */
import { useQuery } from '@tanstack/react-query'
import { Braces, FileText, ListTree, MessageSquareText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

import { getTaskResultPreview } from '../api'
import { JsonBlock } from '../components/json-block'
import { TASK_STATUS } from '../constants'
import type { UsageLog } from '../data/schema'
import { formatJsonBody } from '../lib/format'
import { taskStatusMapper } from '../lib/mappers'
import type { LogOtherData, RequestResponseLog } from '../types'
import { Log4GenerationView } from './log4-generation-view'
import { Log4ImageGallery } from './log4-image-viewer'
import { RoleBadge } from './role-badge'
import {
  extractMessageImages,
  type ParsedGenerationRequest,
  type ParsedMessage,
  type ParsedResponse,
} from './request-body'

type RequestViewMode = 'structured' | 'messages' | 'json'
type ResultViewMode = 'preview' | 'json'

const VIDEO_STATUS_TO_TASK_STATUS: Record<string, string> = {
  queued: TASK_STATUS.QUEUED,
  in_progress: TASK_STATUS.IN_PROGRESS,
  completed: TASK_STATUS.SUCCESS,
  failed: TASK_STATUS.FAILURE,
  unknown: TASK_STATUS.UNKNOWN,
}

function ViewModeToggle<T extends string>(props: {
  value: T
  options: Array<{ id: T; label: string; icon: React.ReactNode }>
  onChange: (value: T) => void
}) {
  return (
    <div
      role='group'
      className='bg-muted/40 inline-flex flex-wrap gap-1 rounded-md border p-0.5'
    >
      {props.options.map((option) => {
        const active = props.value === option.id
        return (
          <Button
            key={option.id}
            type='button'
            size='sm'
            variant={active ? 'secondary' : 'ghost'}
            className={cn(
              'h-7 gap-1.5 px-2 text-xs',
              active && 'bg-background shadow-xs'
            )}
            aria-pressed={active}
            onClick={() => props.onChange(option.id)}
          >
            {option.icon}
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

/** Prompt-style generation bodies become a single user message for Message mode. */
function generationAsMessages(
  request: ParsedGenerationRequest
): ParsedMessage[] {
  return [
    {
      role: 'user',
      text: request.prompt,
      imageCount: request.images.length || undefined,
      raw: { role: 'user', content: request.prompt },
    },
  ]
}

function GenerationMessagesView(props: { request: ParsedGenerationRequest }) {
  const { t } = useTranslation()
  const messages = useMemo(
    () => generationAsMessages(props.request),
    [props.request]
  )

  return (
    <div className='space-y-3'>
      {messages.map((message) => {
        const images =
          message.role === 'user'
            ? props.request.images
            : extractMessageImages(message)
        return (
          <div
            key={`gen-msg-${message.role}-${message.text.slice(0, 48)}`}
            className='bg-muted/20 space-y-2 rounded-lg border p-3'
          >
            <div className='flex items-center gap-2'>
              <RoleBadge role={message.role} />
              <span className='text-muted-foreground text-[11px]'>
                {t('Message')}
              </span>
            </div>
            <pre className='text-xs leading-relaxed break-all whitespace-pre-wrap'>
              {message.text}
            </pre>
            {images.length > 0 ? (
              <Log4ImageGallery
                images={images}
                thumbnailClassName='size-24'
              />
            ) : null}
          </div>
        )
      })}
      {props.request.params.length > 0 ? (
        <div className='text-muted-foreground text-xs'>
          {t(
            'Generation parameters are listed in Structured view; Message view focuses on the prompt text.'
          )}
        </div>
      ) : null}
    </div>
  )
}

function TaskResultCard(props: {
  taskId: string
  status?: string
}) {
  const { t } = useTranslation()
  const taskStatus = props.status
    ? (VIDEO_STATUS_TO_TASK_STATUS[props.status] ?? props.status)
    : ''

  return (
    <div className='bg-muted/30 space-y-2 rounded-lg border p-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-semibold'>{t('Task ID')}</span>
        <span className='font-mono text-xs break-all'>{props.taskId}</span>
        <CopyButton
          value={props.taskId}
          className='h-6 w-6 p-0'
          iconClassName='size-3.5'
        />
        {taskStatus ? (
          <StatusBadge
            label={t(taskStatusMapper.getLabel(taskStatus, taskStatus))}
            variant={taskStatusMapper.getVariant(taskStatus)}
            size='sm'
            copyable={false}
          />
        ) : null}
      </div>
    </div>
  )
}

function UpstreamVideoPlayer(props: { url: string }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)

  if (failed) {
    return (
      <div className='space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400'>
        <p>{t('Media preview failed. Please try again.')}</p>
        <p className='break-all opacity-80'>{props.url}</p>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => {
            setFailed(false)
            setRevision((value) => value + 1)
          }}
        >
          {t('Retry')}
        </Button>
      </div>
    )
  }

  return (
    <video
      key={revision}
      src={props.url}
      controls
      preload='metadata'
      className='max-h-[60vh] w-full rounded-md border bg-black'
      onError={() => setFailed(true)}
    />
  )
}

function GenerationResultBody(props: {
  resultMode: ResultViewMode
  data: RequestResponseLog
  response: ParsedResponse | null
  prettyResponse: string
  copiedText: string | null
  copyToClipboard: (value: string) => void
  taskId: string
  previewStatus: string
  resultURL: string
  isPreviewLoading: boolean
}) {
  const { t } = useTranslation()

  if (props.resultMode === 'json') {
    if (!props.data.response_body) {
      return (
        <div className='text-muted-foreground py-6 text-center text-xs'>
          {t('No response body')}
        </div>
      )
    }
    return (
      <JsonBlock
        label={t('Response Body')}
        content={props.prettyResponse}
        copiedText={props.copiedText}
        copyToClipboard={props.copyToClipboard}
      />
    )
  }

  const successWithoutURL =
    !!props.taskId &&
    !props.isPreviewLoading &&
    !props.resultURL &&
    (props.previewStatus === TASK_STATUS.SUCCESS ||
      props.previewStatus === 'SUCCESS' ||
      props.previewStatus === 'completed')
  const pendingWithoutURL =
    !!props.taskId &&
    !props.isPreviewLoading &&
    !props.resultURL &&
    !successWithoutURL
  const emptyPreview =
    !props.taskId &&
    !(props.response?.images ?? []).length &&
    !props.response?.error

  return (
    <div className='space-y-3'>
      {props.taskId ? (
        <TaskResultCard taskId={props.taskId} status={props.previewStatus} />
      ) : null}

      {props.taskId && props.isPreviewLoading ? (
        <div className='text-muted-foreground flex items-center gap-2 text-xs'>
          <Spinner className='size-3.5' />
          {t('Loading...')}
        </div>
      ) : null}

      {props.resultURL ? (
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>{t('Generated Video')}</Label>
          <UpstreamVideoPlayer url={props.resultURL} />
          <p className='text-muted-foreground break-all font-mono text-[11px]'>
            {props.resultURL}
          </p>
        </div>
      ) : null}

      {successWithoutURL ? (
        <p className='text-muted-foreground text-xs'>
          {t('Video preview URL is unavailable for this task.')}
        </p>
      ) : null}

      {pendingWithoutURL ? (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Asynchronous task — use the task ID to look up its progress and result.'
          )}
        </p>
      ) : null}

      {(props.response?.images ?? []).length > 0 ? (
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>
            {t('Generated Images')}
          </Label>
          <Log4ImageGallery
            images={props.response?.images ?? []}
            totalCount={props.response?.images?.length}
            thumbnailClassName='size-32'
          />
        </div>
      ) : null}

      {props.response?.error ? (
        <div className='rounded-md border border-red-200 bg-red-50 p-2.5 text-xs break-all whitespace-pre-wrap text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400'>
          {props.response.error}
        </div>
      ) : null}

      {emptyPreview ? (
        <div className='text-muted-foreground py-6 text-center text-xs'>
          {props.data.response_body
            ? t(
                'The response content cannot be displayed as structured messages. Check the raw tab.'
              )
            : t('No response body')}
        </div>
      ) : null}
    </div>
  )
}

export function Log4GenerationDetailView(props: {
  request: ParsedGenerationRequest
  response: ParsedResponse | null
  data: RequestResponseLog
  log: UsageLog
  other: LogOtherData
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const [requestMode, setRequestMode] = useState<RequestViewMode>('structured')
  const [resultMode, setResultMode] = useState<ResultViewMode>('preview')

  const taskId = props.response?.task?.id ?? ''
  const taskPreviewQuery = useQuery({
    queryKey: ['log4-task-result-preview', taskId],
    queryFn: async () => {
      const result = await getTaskResultPreview(taskId)
      if (!result.success) {
        return null
      }
      return result.data ?? null
    },
    enabled: !!taskId,
    staleTime: 30_000,
    meta: { errorToast: false },
  })

  const previewStatus =
    taskPreviewQuery.data?.status || props.response?.task?.status || ''
  const resultURL = taskPreviewQuery.data?.result_url ?? ''
  const prettyRequest = useMemo(
    () => formatJsonBody(props.data.request_body),
    [props.data.request_body]
  )
  const prettyResponse = useMemo(
    () => formatJsonBody(props.data.response_body),
    [props.data.response_body]
  )

  const requestModeOptions: Array<{
    id: RequestViewMode
    label: string
    icon: React.ReactNode
  }> = [
    {
      id: 'structured',
      label: t('Structured'),
      icon: <ListTree className='size-3.5' aria-hidden='true' />,
    },
    {
      id: 'messages',
      label: t('Messages'),
      icon: <MessageSquareText className='size-3.5' aria-hidden='true' />,
    },
    {
      id: 'json',
      label: t('JSON'),
      icon: <Braces className='size-3.5' aria-hidden='true' />,
    },
  ]

  const resultModeOptions: Array<{
    id: ResultViewMode
    label: string
    icon: React.ReactNode
  }> = [
    {
      id: 'preview',
      label: t('Preview'),
      icon: <FileText className='size-3.5' aria-hidden='true' />,
    },
    {
      id: 'json',
      label: t('JSON'),
      icon: <Braces className='size-3.5' aria-hidden='true' />,
    },
  ]

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1'>
      <section className='space-y-2'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <span className='text-sm font-semibold'>{t('Request')}</span>
          <ViewModeToggle
            value={requestMode}
            options={requestModeOptions}
            onChange={setRequestMode}
          />
        </div>
        {requestMode === 'structured' ? (
          <Log4GenerationView
            request={props.request}
            log={props.log}
            other={props.other}
            className='h-auto overflow-visible pr-0'
          />
        ) : null}
        {requestMode === 'messages' ? (
          <GenerationMessagesView request={props.request} />
        ) : null}
        {requestMode === 'json' ? (
          <JsonBlock
            label={t('Request Body')}
            content={prettyRequest}
            copiedText={copiedText}
            copyToClipboard={copyToClipboard}
          />
        ) : null}
      </section>

      <section className='space-y-2 border-t pt-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <span className='text-sm font-semibold'>{t('Result')}</span>
          <ViewModeToggle
            value={resultMode}
            options={resultModeOptions}
            onChange={setResultMode}
          />
        </div>

        <GenerationResultBody
          resultMode={resultMode}
          data={props.data}
          response={props.response}
          prettyResponse={prettyResponse}
          copiedText={copiedText}
          copyToClipboard={copyToClipboard}
          taskId={taskId}
          previewStatus={previewStatus}
          resultURL={resultURL}
          isPreviewLoading={taskPreviewQuery.isLoading}
        />
      </section>
    </div>
  )
}
