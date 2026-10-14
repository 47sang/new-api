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
import { ChartPie } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import type { ModelTokenSplitRanks } from '@/features/dashboard/lib'
import type { UsageMetric } from '@/features/dashboard/types'
import { formatCompactNumber, formatNumber, formatPercent } from '@/lib/format'

interface UsageModelCachePanelProps {
  ranks: ModelTokenSplitRanks
  metric: UsageMetric
  locale: Intl.LocalesArgument
  loading: boolean
}

/**
 * 全模型缓存占比：每个模型一行，给出缓存读取 / 非缓存读 / 输出 / 合计与输入侧
 * 缓存命中率，按合计降序，用于横向对比哪个模型缓存打得满、输出占比高。
 * 与 Token 拆分面板一样只在 Token 指标下渲染。
 */
export function UsageModelCachePanel(props: UsageModelCachePanelProps) {
  const { t } = useTranslation()
  if (props.metric !== 'tokens') return null

  const rows = props.ranks.other
    ? [...props.ranks.entries, props.ranks.other]
    : props.ranks.entries
  const locale = props.locale

  let content = (
    <div className='min-w-0'>
      <div className='text-muted-foreground flex items-center gap-2 text-[11px] font-medium'>
        <span className='w-24 min-w-0 shrink-0 sm:w-28'>{t('Model')}</span>
        <span className='hidden w-14 shrink-0 text-right sm:block'>
          {t('Cache Read')}
        </span>
        <span className='hidden w-14 shrink-0 text-right sm:block'>
          {t('Uncached Input')}
        </span>
        <span className='hidden w-14 shrink-0 text-right sm:block'>
          {t('Output')}
        </span>
        <span className='ml-auto w-14 shrink-0 text-right'>{t('Total')}</span>
        <span className='w-11 shrink-0 text-right'>{t('Cache hit rate')}</span>
      </div>
      <ul className='mt-1.5 space-y-1.5'>
        {rows.map((row) => (
          <li
            key={row.isOther ? 'other' : row.model}
            className='flex items-center gap-2 text-xs'
          >
            <span
              className='w-24 min-w-0 shrink-0 truncate sm:w-28'
              title={row.isOther ? t('Other') : row.model}
            >
              {row.isOther ? t('Other') : row.model}
            </span>
            <span className='text-muted-foreground hidden w-14 shrink-0 text-right tabular-nums sm:block'>
              {formatCompactNumber(row.cacheRead, locale)}
            </span>
            <span className='text-muted-foreground hidden w-14 shrink-0 text-right tabular-nums sm:block'>
              {formatCompactNumber(row.uncachedInput, locale)}
            </span>
            <span className='text-muted-foreground hidden w-14 shrink-0 text-right tabular-nums sm:block'>
              {formatCompactNumber(row.output, locale)}
            </span>
            <span
              className='ml-auto w-14 shrink-0 text-right tabular-nums'
              title={formatNumber(row.total, locale)}
            >
              {formatCompactNumber(row.total, locale)}
            </span>
            <span className='w-11 shrink-0 text-right font-medium tabular-nums'>
              {row.cacheHitRate === null ? '—' : formatPercent(row.cacheHitRate)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
  if (props.loading) {
    content = (
      <div className='space-y-2'>
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className='h-4 w-full' />
        ))}
      </div>
    )
  } else if (rows.length === 0) {
    content = (
      <div className='text-muted-foreground flex min-h-24 items-center justify-center px-2 text-center text-sm'>
        {t('No cache breakdown data in the selected range')}
      </div>
    )
  }

  return (
    <section
      className='bg-muted/20 rounded-lg border p-3 sm:p-4'
      aria-label={t('Model cache share')}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <span className='bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex size-5 shrink-0 items-center justify-center rounded-md'>
          <ChartPie className='size-3' aria-hidden='true' />
        </span>
        <span className='text-sm font-semibold'>{t('Model cache share')}</span>
        <span className='text-muted-foreground text-xs'>
          {t('by tokens')} · {t('Cache hit rate = cache read / (cache read + uncached input)')}
        </span>
      </div>
      <div className='mt-3'>{content}</div>
    </section>
  )
}
