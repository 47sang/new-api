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
import { Medal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import type { UsageMetric } from '@/features/dashboard/types'
import {
  type UsageModelRank,
  USAGE_OTHER_COLOR,
} from '@/features/dashboard/lib'
import { formatCompactNumber, formatQuota } from '@/lib/format'

interface UsageTopModelsProps {
  models: UsageModelRank[]
  colorMap: Record<string, string>
  metric: UsageMetric
  locale: Intl.LocalesArgument
  loading: boolean
}

/** 按指标格式化榜单数值（与柱状图 tooltip 同口径） */
function formatRankValue(
  value: number,
  metric: UsageMetric,
  locale: Intl.LocalesArgument
): string {
  if (metric === 'spend') return formatQuota(value)
  return formatCompactNumber(value, locale)
}

/** Top models 榜单（B15-B18）：模型名 + 数值 + 与榜首比值进度条，颜色与柱状图一致 */
export function UsageTopModels(props: UsageTopModelsProps) {
  const { t } = useTranslation()

  let byLabelKey = 'by tokens'
  if (props.metric === 'spend') byLabelKey = 'by spend'
  else if (props.metric === 'requests') byLabelKey = 'by requests'

  let body = (
    <ul className='mt-3 space-y-3'>
      {props.models.map((rank) => (
        <li key={rank.model}>
          <div className='flex items-center justify-between gap-2'>
            <span className='truncate text-sm' title={rank.model}>
              {rank.model}
            </span>
            <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
              {formatRankValue(rank.value, props.metric, props.locale)}
            </span>
          </div>
          <div
            className='bg-muted mt-1 h-1.5 overflow-hidden rounded-full'
            role='presentation'
          >
            <div
              className='h-full rounded-full transition-[width]'
              style={{
                width: `${Math.round(rank.ratio * 100)}%`,
                backgroundColor:
                  props.colorMap[rank.model] ?? USAGE_OTHER_COLOR,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
  if (props.loading) {
    body = (
      <div className='mt-3 space-y-3'>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className='space-y-1.5'>
            <Skeleton className='h-4 w-3/4' />
            <Skeleton className='h-1.5 w-full rounded-full' />
          </div>
        ))}
      </div>
    )
  } else if (props.models.length === 0) {
    body = (
      <div className='text-muted-foreground mt-6 flex items-center justify-center text-sm'>
        {t('No usage data in the selected range')}
      </div>
    )
  }

  return (
    <section
      className='bg-muted/20 rounded-lg border p-3 sm:p-4'
      aria-label={t('Top models')}
    >
      <div className='flex items-center gap-2'>
        <span className='bg-amber-500/10 text-amber-600 dark:text-amber-400 flex size-5 shrink-0 items-center justify-center rounded-md'>
          <Medal className='size-3' aria-hidden='true' />
        </span>
        <span className='text-sm font-semibold'>{t('Top models')}</span>
        <span className='text-muted-foreground text-xs'>{t(byLabelKey)}</span>
      </div>
      {body}
    </section>
  )
}
