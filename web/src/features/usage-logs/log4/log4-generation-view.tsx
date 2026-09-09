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
 * (image generation, video task creation): the full prompt text plus the
 * remaining request parameters, instead of the chat message browser.
 */
import { useTranslation } from 'react-i18next'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import { JsonBlock } from '../components/json-block'
import { LogCostDisplay } from '../components/log-cost-display'
import type { UsageLog } from '../data/schema'
import type { LogOtherData } from '../types'
import { StatRow } from './log4-request-view'
import type { ParsedGenerationRequest } from './request-body'

/** Input tab for generation requests: prompt + parameters + cost facts. */
export function Log4GenerationView(props: {
  request: ParsedGenerationRequest
  log: UsageLog
  other: LogOtherData
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const params = props.request.params

  return (
    <div className='h-full min-h-0 space-y-3 overflow-y-auto pr-1'>
      <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]'>
        <JsonBlock
          label={t('Prompt')}
          content={props.request.prompt}
          copiedText={copiedText}
          copyToClipboard={copyToClipboard}
        />
        <div className='flex min-w-0 flex-col gap-3'>
          <div className='bg-muted/30 flex flex-col gap-1.5 rounded-lg border p-3'>
            <StatRow label={t('Model')}>{props.log.model_name}</StatRow>
            <StatRow label={t('Cost')}>
              <LogCostDisplay quota={props.log.quota} other={props.other} />
            </StatRow>
          </div>
          {params.length > 0 && (
            <div className='bg-muted/30 flex flex-col gap-1.5 rounded-lg border p-3'>
              <span className='text-muted-foreground text-xs font-semibold'>
                {t('Parameters')}
              </span>
              {params.map((param) => (
                <div
                  key={param.key}
                  className='flex flex-col gap-0.5 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-2'
                >
                  <span className='text-muted-foreground shrink-0 font-mono'>
                    {param.key}
                  </span>
                  <span className='min-w-0 text-right font-mono break-all whitespace-pre-wrap'>
                    {param.value}
                    {param.truncated && (
                      <span className='text-muted-foreground block text-left sm:text-right'>
                        {t(
                          '… truncated — check the raw tab for the full value'
                        )}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
