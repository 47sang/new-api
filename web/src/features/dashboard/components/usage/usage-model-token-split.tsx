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
import { ArrowLeft, ChartColumnBig, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  USAGE_TOKEN_SPLIT_COLORS,
  type TokenSplitTotals,
  tokenSplitShares,
} from '@/features/dashboard/lib'
import type { UsageMetric } from '@/features/dashboard/types'
import { formatCompactNumber, formatNumber, formatPercent } from '@/lib/format'

interface UsageModelTokenSplitProps {
  model: string
  split: TokenSplitTotals
  metric: UsageMetric
  locale: Intl.LocalesArgument
  loading: boolean
  error: boolean
  onRetry: () => void
  onBack: () => void
}

/** 100% 三段堆叠条：三段宽度即各自占三项合计的比例，数值已在旁边以文本给出，故对辅助技术隐藏 */
function TokenSplitBar(props: { split: TokenSplitTotals }) {
  const shares = tokenSplitShares(props.split)
  const segments = [
    { key: 'cacheRead', share: shares.cacheRead, color: USAGE_TOKEN_SPLIT_COLORS.cacheRead },
    {
      key: 'uncachedInput',
      share: shares.uncachedInput,
      color: USAGE_TOKEN_SPLIT_COLORS.uncachedInput,
    },
    { key: 'output', share: shares.output, color: USAGE_TOKEN_SPLIT_COLORS.output },
  ]
  return (
    <div
      className='bg-muted flex h-2.5 overflow-hidden rounded-full'
      role='presentation'
    >
      {segments.map((segment) =>
        segment.share > 0 ? (
          <div
            key={segment.key}
            style={{
              width: `${segment.share}%`,
              backgroundColor: segment.color,
            }}
          />
        ) : null
      )}
    </div>
  )
}

/**
 * 选中模型的 Token 拆分面板：缓存读取 / 非缓存读取 / 输出三项数值、占比与输入侧缓存命中率。
 * 只在 Token 指标下有意义，其他指标给出提示而不是渲染无意义的数字。
 */
export function UsageModelTokenSplit(props: UsageModelTokenSplitProps) {
  const { t } = useTranslation()
  const locale = props.locale
  const split = props.split
  const shares = tokenSplitShares(split)

  if (props.metric !== 'tokens') {
    return (
      <section
        className='bg-muted/20 rounded-lg border p-3 sm:p-4'
        aria-label={t('Token breakdown')}
      >
        <div className='text-muted-foreground flex min-h-32 items-center justify-center px-2 text-center text-sm'>
          {t('Token breakdown is only available for the Token metric')}
        </div>
      </section>
    )
  }

  let body = (
    <>
      <TokenSplitBar split={split} />
      <dl className='mt-3 space-y-2'>
        {[
          {
            key: 'cacheRead',
            label: t('Cache Read'),
            value: split.cacheRead,
            share: shares.cacheRead,
            color: USAGE_TOKEN_SPLIT_COLORS.cacheRead,
          },
          {
            key: 'uncachedInput',
            label: t('Uncached Input'),
            value: split.uncachedInput,
            share: shares.uncachedInput,
            color: USAGE_TOKEN_SPLIT_COLORS.uncachedInput,
          },
          {
            key: 'output',
            label: t('Output'),
            value: split.output,
            share: shares.output,
            color: USAGE_TOKEN_SPLIT_COLORS.output,
          },
        ].map((row) => (
          <div
            key={row.key}
            className='flex items-center gap-2 text-xs'
          >
            <span
              className='size-2 shrink-0 rounded-full'
              style={{ backgroundColor: row.color }}
              aria-hidden='true'
            />
            <dt className='text-muted-foreground shrink-0'>{row.label}</dt>
            <dd
              className='ml-auto flex items-baseline gap-1.5 tabular-nums'
              title={formatNumber(row.value, locale)}
            >
              <span>{formatCompactNumber(row.value, locale)}</span>
              <span className='text-muted-foreground w-10 text-right'>
                {formatPercent(row.share)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <div className='mt-3 flex items-center justify-between gap-2 border-t pt-2.5 text-xs'>
        <span className='text-muted-foreground'>{t('Total')}</span>
        <span
          className='font-medium tabular-nums'
          title={formatNumber(split.total, locale)}
        >
          {formatCompactNumber(split.total, locale)}
        </span>
      </div>
      <div className='mt-1.5 flex items-center justify-between gap-2 text-xs'>
        <span className='text-muted-foreground'>{t('Cache hit rate')}</span>
        <span className='font-medium tabular-nums'>
          {split.cacheHitRate === null ? '—' : formatPercent(split.cacheHitRate)}
        </span>
      </div>
    </>
  )
  if (props.loading) {
    body = (
      <div className='space-y-3'>
        <Skeleton className='h-2.5 w-full rounded-full' />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className='h-4 w-full' />
        ))}
        <Skeleton className='h-4 w-1/2' />
      </div>
    )
  } else if (props.error) {
    body = (
      <div className='text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-2 text-sm'>
        <span>{t('Failed to load usage data')}</span>
        <Button variant='outline' size='sm' onClick={props.onRetry}>
          <RotateCw className='size-3.5' aria-hidden='true' />
          {t('Retry')}
        </Button>
      </div>
    )
  } else if (!split.hasSplitData) {
    body = (
      <div className='text-muted-foreground flex min-h-32 items-center justify-center px-2 text-center text-sm'>
        {t('No cache breakdown data for this model in the selected range')}
      </div>
    )
  }

  return (
    <section
      className='bg-muted/20 rounded-lg border p-3 sm:p-4'
      aria-label={t('Token breakdown')}
    >
      <div className='flex items-center gap-2'>
        <span className='bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-md'>
          <ChartColumnBig className='size-3' aria-hidden='true' />
        </span>
        <span className='shrink-0 text-sm font-semibold'>
          {t('Token breakdown')}
        </span>
        <span
          className='text-muted-foreground min-w-0 flex-1 truncate text-xs'
          title={props.model}
        >
          {props.model}
        </span>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 shrink-0 px-2 text-xs'
          onClick={props.onBack}
        >
          <ArrowLeft className='size-3.5' aria-hidden='true' />
          {t('Back to Top models')}
        </Button>
      </div>
      <div className='mt-3'>{body}</div>
    </section>
  )
}
