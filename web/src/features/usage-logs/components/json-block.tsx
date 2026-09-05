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
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Collapsible JSON/text block with a copy button, shared by log dialogs. */
export function JsonBlock(props: {
  label: string
  content: string
  copiedText: string | null
  copyToClipboard: (text: string) => void
  className?: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const maxPreviewLines = 50
  const lines = props.content.split('\n')
  const isLong = lines.length > maxPreviewLines

  return (
    <div className={cn('space-y-1.5', props.className)}>
      <div className='flex items-center justify-between'>
        <Label className='text-xs font-semibold'>{props.label}</Label>
        <div className='flex items-center gap-1'>
          {isLong && (
            <Button
              variant='ghost'
              size='sm'
              className='h-6 px-2 text-xs'
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? t('Collapse') : t('Expand')}
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            className='h-6 w-6 p-0'
            onClick={() => props.copyToClipboard(props.content)}
            title={t('Copy to clipboard')}
            aria-label={t('Copy to clipboard')}
          >
            {props.copiedText === props.content ? (
              <Check className='size-3.5 text-green-600' />
            ) : (
              <Copy className='size-3.5' />
            )}
          </Button>
        </div>
      </div>
      <div className='bg-muted/30 relative overflow-hidden rounded-md border'>
        <pre
          className={cn(
            'overflow-x-auto p-3 text-xs leading-relaxed whitespace-pre-wrap break-all',
            !expanded && isLong && 'max-h-[300px]'
          )}
        >
          {props.content}
        </pre>
      </div>
    </div>
  )
}
