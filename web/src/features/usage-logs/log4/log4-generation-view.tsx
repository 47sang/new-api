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
 * Input tab of the Log4 detail dialog for prompt-style generation requests
 * (image generation, video task creation). The layout mirrors the chat
 * input tab: the model/cost facts and the remaining request parameters on
 * top, the full prompt text below them, then reference images as
 * attachment thumbnails sharing the output tab's lightbox preview — so
 * long parameter values (metadata JSON that embeds the whole prompt)
 * never wrap inside a narrow side column.
 */
import { useTranslation } from 'react-i18next'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import { JsonBlock } from '../components/json-block'
import { LogCostDisplay } from '../components/log-cost-display'
import type { UsageLog } from '../data/schema'
import type { LogOtherData } from '../types'
import { Log4ImageGallery } from './log4-image-viewer'
import { StatRow } from './log4-request-view'
import type { ParsedGenerationRequest } from './request-body'

/**
 * Length above which a generation parameter value stops rendering as a
 * single stat line and gets its own full-width collapsible block. Long
 * pretty-printed JSON (video metadata embedding the whole prompt) and
 * inline base64 reference images exceed it by orders of magnitude.
 */
const MAX_SINGLE_LINE_PARAM_LENGTH = 80

/** Input tab for generation requests: cost facts + parameters + prompt. */
export function Log4GenerationView(props: {
  request: ParsedGenerationRequest
  log: UsageLog
  other: LogOtherData
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  // The stat card shows the billed model (log.model_name); the request's
  // own model param is only hidden when it says the same thing, so a
  // redirected request still surfaces the model the client asked for.
  const params = props.request.params.filter(
    (param) => !(param.key === 'model' && param.value === props.log.model_name)
  )

  return (
    <div className='h-full min-h-0 space-y-3 overflow-y-auto pr-1'>
      {/* Model/cost facts lead, mirroring the chat input tab's stats
          header so both input layouts read the same way. */}
      <div className='bg-muted/30 grid gap-1.5 rounded-lg border p-3 sm:grid-cols-2'>
        <StatRow label={t('Model')}>
          <span title={props.log.model_name}>{props.log.model_name}</span>
        </StatRow>
        <StatRow label={t('Cost')}>
          <LogCostDisplay quota={props.log.quota} other={props.other} />
        </StatRow>
      </div>
      {params.length > 0 && (
        <div className='space-y-2'>
          <span className='text-muted-foreground text-xs font-semibold'>
            {t('Parameters')}
          </span>
          {params.map((param) => {
            const isBlockValue =
              param.value.length > MAX_SINGLE_LINE_PARAM_LENGTH ||
              param.value.includes('\n')
            if (!isBlockValue) {
              return (
                <div
                  key={param.key}
                  className='flex items-baseline justify-between gap-2 text-xs'
                >
                  <span className='text-muted-foreground shrink-0 font-mono'>
                    {param.key}
                  </span>
                  <span className='min-w-0 text-right font-mono break-all'>
                    {param.value}
                  </span>
                </div>
              )
            }
            // Long values (pretty-printed JSON objects, clipped inline
            // image payloads) get a full-width collapsible block — the
            // JsonBlock caps the height and offers Expand/Copy.
            return (
              <div key={param.key} className='space-y-1'>
                <JsonBlock
                  label={param.key}
                  content={param.value}
                  copiedText={copiedText}
                  copyToClipboard={copyToClipboard}
                />
                {param.truncated && (
                  <div className='text-muted-foreground text-xs'>
                    {t('… truncated — check the raw tab for the full value')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <JsonBlock
        label={t('Prompt')}
        content={props.request.prompt}
        copiedText={copiedText}
        copyToClipboard={copyToClipboard}
      />
      {props.request.images.length > 0 && (
        <div className='space-y-1.5'>
          <span className='text-muted-foreground text-xs font-semibold'>
            {t('Reference Images')}
          </span>
          {/* Same gallery as the output tab: thumbnails open the shared
              fullscreen lightbox preview. */}
          <Log4ImageGallery
            images={props.request.images}
            thumbnailClassName='size-32'
          />
        </div>
      )}
    </div>
  )
}
