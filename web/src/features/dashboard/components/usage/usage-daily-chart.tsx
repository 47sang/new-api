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
import { VChart } from '@visactor/react-vchart'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useTheme } from '@/context/theme-provider'
import type { DailySeriesPoint } from '@/features/dashboard/lib'
import type { UsageMetric } from '@/features/dashboard/types'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { VCHART_OPTION } from '@/lib/vchart'

interface UsageDailyChartProps {
  series: DailySeriesPoint[]
  colorMap: Record<string, string>
  metric: UsageMetric
  loading: boolean
  isEmpty: boolean
}

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

/** 按指标格式化 tooltip 数值：消费走金额显示配置，其余用紧凑数字 */
function makeValueFormatter(metric: UsageMetric) {
  if (metric !== 'spend') {
    return (value: number) => formatCompactNumber(value)
  }
  return (value: number) => {
    const { config, meta } = getCurrencyDisplay()
    if (meta.kind === 'tokens') return value.toLocaleString()
    const usd = value / config.quotaPerUnit
    const rate = 'exchangeRate' in meta ? meta.exchangeRate : 1
    const symbol = 'symbol' in meta ? meta.symbol : '$'
    return symbol + (usd * rate).toFixed(4)
  }
}

/** 每日按模型堆叠柱状图（B10-B13）：悬浮展示各模型明细与当日合计（B11） */
export function UsageDailyChart(props: UsageDailyChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const updateTheme = async () => {
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      if (cancelled) return
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }

    void updateTheme()
    return () => {
      cancelled = true
    }
  }, [resolvedTheme])

  const formatValue = useMemo(
    () => makeValueFormatter(props.metric),
    [props.metric]
  )

  const spec = useMemo(() => {
    return {
      type: 'bar',
      data: [{ id: 'usageDaily', values: props.series }],
      xField: 'Day',
      yField: 'Value',
      seriesField: 'Model',
      stack: true,
      color: { specified: props.colorMap },
      legends: { visible: true, selectMode: 'single' },
      axes: [
        {
          orient: 'left',
          label: {
            // Y 轴刻度加千位分隔符（1,000,000），提升大数可读性
            formatMethod: (val: number | string) => formatNumber(Number(val)),
          },
        },
      ],
      bar: {
        state: {
          hover: { stroke: '#000', lineWidth: 1 },
        },
      },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                formatValue(Number(datum?.Value) || 0),
            },
          ],
        },
        dimension: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) => Number(datum?.Value) || 0,
            },
          ],
          updateContent: (
            array: { key: string; value: number; hasShape?: boolean }[]
          ) => {
            const items = [...array].sort(
              (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
            )
            const sum = items.reduce(
              (acc, item) => acc + (Number(item.value) || 0),
              0
            )
            const formatted = items.map((item) => ({
              key: item.key,
              value: formatValue(Number(item.value) || 0),
              hasShape: true,
            }))
            formatted.unshift({
              key: t('Total'),
              value: formatValue(sum),
              hasShape: false,
            })
            return formatted
          },
        },
      },
      background: { fill: 'transparent' },
      animation: false,
    }
  }, [props.series, props.colorMap, formatValue, t])

  if (props.loading) {
    return <Skeleton className='h-[280px] w-full' />
  }

  if (props.isEmpty) {
    return (
      <div className='text-muted-foreground flex h-[280px] items-center justify-center text-sm'>
        {t('No usage data in the selected range')}
      </div>
    )
  }

  return (
    <div className='h-[280px]' aria-label={t('Daily by model')}>
      {themeReady && (
        <VChart
          key={`${props.metric}-${resolvedTheme}-${props.series.length}`}
          spec={{
            ...spec,
            theme: resolvedTheme === 'dark' ? 'dark' : 'light',
            background: 'transparent',
          }}
          option={VCHART_OPTION}
        />
      )}
    </div>
  )
}
