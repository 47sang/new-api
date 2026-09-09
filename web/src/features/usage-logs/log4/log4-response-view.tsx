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
import { Wrench } from 'lucide-react'
/**
 * Output tab of the Log4 detail dialog: response stats followed by the
 * chain-of-thought, tool calls and final answer extracted from the
 * stored response body. Generation responses render their image gallery
 * or the async task-creation envelope instead.
 */
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Label } from '@/components/ui/label'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

import { JsonBlock } from '../components/json-block'
import { LogCostDisplay } from '../components/log-cost-display'
import { TASK_STATUS } from '../constants'
import type { UsageLog } from '../data/schema'
import { taskStatusMapper } from '../lib/mappers'
import type { LogOtherData, RequestResponseLog } from '../types'
import { Log4ImageGallery } from './log4-image-viewer'
import type { ParsedResponse } from './request-body'

function ToolCallCard(props: { name: string; arguments: string }) {
  return (
    <div className='bg-muted/30 min-w-0 space-y-1 rounded-md border p-2.5'>
      <div className='flex items-center gap-1.5'>
        <Wrench className='size-3.5 text-amber-500' aria-hidden='true' />
        <span className='font-mono text-xs font-medium'>{props.name}</span>
      </div>
      {props.arguments ? (
        <pre className='max-h-72 overflow-y-auto text-xs leading-relaxed break-all whitespace-pre-wrap'>
          {props.arguments}
        </pre>
      ) : null}
    </div>
  )
}

/**
 * Creation responses report the OpenAI-video status vocabulary (queued /
 * in_progress / completed / failed); normalize it to the shared task
 * status keys so the label and color reuse the task log mappings.
 */
const VIDEO_STATUS_TO_TASK_STATUS: Record<string, string> = {
  queued: TASK_STATUS.QUEUED,
  in_progress: TASK_STATUS.IN_PROGRESS,
  completed: TASK_STATUS.SUCCESS,
  failed: TASK_STATUS.FAILURE,
  unknown: TASK_STATUS.UNKNOWN,
}

/** Async task-creation envelope: copyable public task id plus status. */
function TaskCreationCard(props: {
  task: NonNullable<ParsedResponse['task']>
}) {
  const { t } = useTranslation()
  const task = props.task
  const taskStatus = task.status
    ? (VIDEO_STATUS_TO_TASK_STATUS[task.status] ?? task.status)
    : ''

  return (
    <div className='bg-muted/30 space-y-2 rounded-lg border p-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-semibold'>{t('Task ID')}</span>
        <span className='font-mono text-xs break-all'>{task.id}</span>
        <CopyButton
          value={task.id}
          className='h-6 w-6 p-0'
          iconClassName='size-3.5'
        />
        {taskStatus && (
          <StatusBadge
            label={t(taskStatusMapper.getLabel(taskStatus, taskStatus))}
            variant={taskStatusMapper.getVariant(taskStatus)}
            size='sm'
            copyable={false}
          />
        )}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Asynchronous task — use the task ID to look up its progress and result.'
        )}
      </p>
    </div>
  )
}

/** Output tab: stats row + reasoning / tool calls / final answer blocks. */
export function Log4ResponseView(props: {
  data: RequestResponseLog
  response: ParsedResponse | null
  log: UsageLog
  other: LogOtherData
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const response = props.response

  if (!response) {
    return (
      <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
        {t(
          'The response content cannot be displayed as structured messages. Check the raw tab.'
        )}
      </div>
    )
  }

  const completionTokens = props.log.completion_tokens || 0
  // Precomputed keys keep the map callback free of index-based keys.
  const callCards = (response.toolCalls ?? []).map((call, position) => ({
    key: `call-${position}-${call.name}`,
    call,
  }))

  return (
    <div className='h-full min-h-0 space-y-3 overflow-y-auto pr-1'>
      {/* Response facts */}
      <div className='bg-muted/30 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border p-3'>
        <span className='text-xs'>
          <span className='text-muted-foreground'>{t('Output')}: </span>
          <span className='font-mono font-medium tabular-nums'>
            {completionTokens.toLocaleString()} tok
          </span>
        </span>
        <span className='text-xs'>
          <span className='text-muted-foreground'>{t('Model')}: </span>
          <span className='font-mono'>{props.log.model_name}</span>
        </span>
        {/* inline-flex keeps the label and the quota badge on one line:
            LogCostDisplay renders a block div, which would stack under the
            label text inside a plain span. */}
        <span className='inline-flex items-center gap-1 text-xs'>
          <span className='text-muted-foreground'>{t('Cost')}:</span>
          <LogCostDisplay quota={props.log.quota} other={props.other} />
        </span>
        {props.data.status_code > 0 && (
          <StatusBadge
            label={`HTTP ${props.data.status_code}`}
            variant={props.data.status_code < 400 ? 'green' : 'red'}
            size='sm'
            copyable={false}
          />
        )}
        {props.data.is_stream && (
          <StatusBadge
            label={t('Streaming')}
            variant='blue'
            size='sm'
            copyable={false}
          />
        )}
        {!props.data.is_completed && (
          <StatusBadge
            label={t('Incomplete')}
            variant='orange'
            size='sm'
            copyable={false}
          />
        )}
        {response.finishReason && (
          <span className='text-muted-foreground text-xs'>
            {t('Finish Reason')}:{' '}
            <span className='text-foreground font-mono'>
              {response.finishReason}
            </span>
          </span>
        )}
      </div>

      {response.task && <TaskCreationCard task={response.task} />}

      {response.error && (
        <div className='rounded-md border border-red-200 bg-red-50 p-2.5 text-xs break-all whitespace-pre-wrap text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400'>
          {response.error}
        </div>
      )}

      {(response.images ?? []).length > 0 && (
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>
            {t('Generated Images')}
          </Label>
          {/* Generation previews use larger thumbnails than chat message
              images; the lightbox shows the full picture either way. */}
          <Log4ImageGallery
            images={response.images ?? []}
            totalCount={response.images?.length}
            thumbnailClassName='size-32'
          />
        </div>
      )}

      {response.audio && (
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>{t('Audio')}</Label>
          {/* Native controls: the data URI is decoded from the response
              body already in memory, so no lazy loading is needed. */}
          <audio
            controls
            preload='metadata'
            src={response.audio.url}
            className='bg-muted/30 w-full rounded-md border'
          />
        </div>
      )}

      {response.reasoning && (
        <JsonBlock
          label={t('Thinking')}
          content={response.reasoning}
          copiedText={copiedText}
          copyToClipboard={copyToClipboard}
        />
      )}

      {(response.toolCalls ?? []).length > 0 && (
        <div className='space-y-1.5'>
          <span className='text-xs font-semibold'>{t('Tool calls')}</span>
          {callCards.map((entry) => (
            <ToolCallCard
              key={entry.key}
              name={entry.call.name}
              arguments={entry.call.arguments}
            />
          ))}
        </div>
      )}

      {response.content ? (
        <JsonBlock
          label={t('Output Result')}
          content={response.content}
          copiedText={copiedText}
          copyToClipboard={copyToClipboard}
        />
      ) : null}

      {response.refusal && (
        <div
          className={cn(
            'rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs whitespace-pre-wrap dark:border-amber-900 dark:bg-amber-950/20'
          )}
        >
          {response.refusal}
        </div>
      )}

      {!response.reasoning &&
      !response.content &&
      !(response.toolCalls ?? []).length &&
      !response.audio &&
      !(response.images ?? []).length &&
      !response.task &&
      !response.error &&
      !response.refusal ? (
        <div className='text-muted-foreground py-8 text-center text-xs'>
          {props.data.response_body && !props.data.is_completed
            ? t('Response body not recorded (binary response or interrupted)')
            : t('No response body')}
        </div>
      ) : null}
    </div>
  )
}
