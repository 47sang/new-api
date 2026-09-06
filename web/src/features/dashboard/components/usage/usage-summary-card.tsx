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
import { ArrowDown, ArrowUp, ChartColumnBig, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  USAGE_METRIC_OPTIONS,
  USAGE_TIME_RANGE_OPTIONS,
} from '@/features/dashboard/constants'
import type {
  DailySeriesPoint,
  PeriodChange,
  UsageModelRank,
} from '@/features/dashboard/lib'
import type { UsageMetric } from '@/features/dashboard/types'
import { getCurrencyDisplay } from '@/lib/currency'
import {
  formatCompactNumber,
  formatNumber,
  formatPercent,
  formatQuota,
} from '@/lib/format'
import { cn } from '@/lib/utils'

import { UsageDailyChart } from './usage-daily-chart'
import { UsageTopModels } from './usage-top-models'

interface UsageSummaryCardProps {
  rangeDays: 7 | 30 | 90
  metric: UsageMetric
  onRangeChange: (days: 7 | 30 | 90) => void
  onMetricChange: (metric: UsageMetric) => void
  summary: number
  change: PeriodChange
  series: DailySeriesPoint[]
  colorMap: Record<string, string>
  topModels: UsageModelRank[]
  locale: Intl.LocalesArgument
  loading: boolean
  error: boolean
  onRetry: () => void
  isEmpty: boolean
}

/** 消费指标的大数字展示与完整值（沿用系统金额显示配置） */
function formatSpendFull(quota: number): string {
  const { config, meta } = getCurrencyDisplay()
  if (meta.kind === 'tokens') return quota.toLocaleString()
  const usd = quota / config.quotaPerUnit
  const rate = 'exchangeRate' in meta ? meta.exchangeRate : 1
  const symbol = 'symbol' in meta ? meta.symbol : '$'
  return symbol + (usd * rate).toFixed(4)
}

/** 环比徽标：新增 / 0% / 涨（绿）/ 跌（红），附说明文案（B8） */
function ChangeBadge(props: { change: PeriodChange }) {
  const { t } = useTranslation()
  const change = props.change
  if (change.kind === 'new') {
    return (
      <span className='inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
        <ArrowUp className='size-3' aria-hidden='true' />
        {t('New')}
      </span>
    )
  }
  if (change.kind === 'zero') {
    return (
      <span className='text-muted-foreground text-xs'>0%</span>
    )
  }
  const increase = change.kind === 'increase'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        increase
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400'
      )}
    >
      {increase ? (
        <ArrowUp className='size-3' aria-hidden='true' />
      ) : (
        <ArrowDown className='size-3' aria-hidden='true' />
      )}
      {increase ? '+' : ''}
      {formatPercent(change.percent)}
    </span>
  )
}

export function UsageSummaryCard(props: UsageSummaryCardProps) {
  const { t } = useTranslation()

  // Base UI Select 触发器需要显式 label 映射，否则显示原始 value
  const rangeItems = USAGE_TIME_RANGE_OPTIONS.map((option) => ({
    value: String(option.value),
    label: t(option.labelKey),
  }))
  const rangeLabel =
    rangeItems.find((item) => item.value === String(props.rangeDays))?.label ??
    String(props.rangeDays)

  return (
    <section className='overflow-hidden rounded-lg border'>
      <header className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5 sm:py-3'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='primary' size='sm'>
            <ChartColumnBig aria-hidden='true' />
          </IconBadge>
          <div className='text-sm font-semibold'>{t('Usage summary')}</div>
        </div>
        <div className='flex flex-wrap items-center gap-1.5 sm:gap-2'>
          <Select
            items={rangeItems}
            value={String(props.rangeDays)}
            onValueChange={(value) =>
              props.onRangeChange(Number(value) as 7 | 30 | 90)
            }
          >
            <SelectTrigger
              className='h-8 w-[150px] text-xs'
              aria-label={t('Time range')}
            >
              <SelectValue>{rangeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {USAGE_TIME_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div
            className='bg-muted/60 inline-flex h-8 overflow-x-auto rounded-lg border p-0.5'
            role='group'
            aria-label={t('Metric')}
          >
            {USAGE_METRIC_OPTIONS.map((option) => (
              <button
                key={option.value}
                type='button'
                aria-pressed={props.metric === option.value}
                onClick={() => props.onMetricChange(option.value)}
                className={cn(
                  'inline-flex shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors',
                  props.metric === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className='grid gap-4 p-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_300px]'>
        <div className='min-w-0 space-y-3'>
          {props.error ? (
            <div className='text-muted-foreground flex h-64 flex-col items-center justify-center gap-2 text-sm'>
              <span>{t('Failed to load usage data')}</span>
              <Button variant='outline' size='sm' onClick={props.onRetry}>
                <RotateCw className='size-3.5' aria-hidden='true' />
                {t('Retry')}
              </Button>
            </div>
          ) : (
            <>
              {props.loading ? (
                <Skeleton className='h-12 w-48' />
              ) : (
                <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
                  <TooltipFullValue
                    display={
                      props.metric === 'spend'
                        ? formatQuota(props.summary)
                        : formatCompactNumber(props.summary, props.locale)
                    }
                    full={
                      props.metric === 'spend'
                        ? formatSpendFull(props.summary)
                        : formatNumber(props.summary, props.locale)
                    }
                  />
                  <span className='flex items-center gap-1.5 pb-1'>
                    <ChangeBadge change={props.change} />
                    <span className='text-muted-foreground text-xs'>
                      {t('vs prev period')}
                    </span>
                  </span>
                </div>
              )}
              <UsageDailyChart
                series={props.series}
                colorMap={props.colorMap}
                metric={props.metric}
                loading={props.loading}
                isEmpty={props.isEmpty}
              />
            </>
          )}
        </div>
        <UsageTopModels
          models={props.topModels}
          colorMap={props.colorMap}
          metric={props.metric}
          locale={props.locale}
          loading={props.loading}
        />
      </div>
    </section>
  )
}

/** 大数字：紧凑展示，悬浮/聚焦显示完整精确值（B7） */
function TooltipFullValue(props: { display: string; full: string }) {
  if (props.display === props.full) {
    return (
      <span className='text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl'>
        {props.display}
      </span>
    )
  }
  return (
    <span
      className='cursor-default text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl'
      title={props.full}
    >
      {props.display}
    </span>
  )
}
