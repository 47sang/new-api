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
import type { IVChart } from '@visactor/vchart'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  /** 当前选中的模型，用于图例重复点击时取消选中 */
  selectedModel: string | null
  /** 图例单选某个模型时回调；取消选中（再次点击同一项）时传 null */
  onSelectedModelChange?: (model: string | null) => void
}

/** 柱状图顶部预留比例：最高柱与绘图区顶端之间保留 25% 高度给悬浮弹窗 */
const TOP_HEADROOM_RATIO = 0.25

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
  // 图例点击经 vchart 实例事件绑定：ref 始终提供最新的选中态与回调，
  // 图表实例因指标/主题切换重建或规格更新后不会读到过期 state
  const selectedModelRef = useRef(props.selectedModel)
  const onSelectedModelChangeRef = useRef(props.onSelectedModelChange)
  selectedModelRef.current = props.selectedModel
  onSelectedModelChangeRef.current = props.onSelectedModelChange

  const handleLegendItemClick = useCallback((event: { value?: unknown }) => {
    // 单选图例的当前选中项：长度 1 为选中该模型，0 为取消选中。
    // vchart 的单选图例不会自行取消选中（重复点击仍上报同一项），
    // 因此同一模型再次传来时按取消选中处理，恢复 Top models 榜单
    const selected = Array.isArray(event?.value) ? event.value : []
    const next =
      selected.length === 1 && typeof selected[0] === 'string'
        ? selected[0]
        : null
    onSelectedModelChangeRef.current?.(
      selectedModelRef.current === next ? null : next
    )
  }, [])

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
    // 最高柱顶满绘图区时悬浮弹窗会被裁切：按堆叠日合计锁定 y 轴上限，
    // 让最高柱只到绘图区高度的 75%，顶部预留 25% 空间展示弹窗
    const dayTotals = new Map<string, number>()
    for (const point of props.series) {
      dayTotals.set(point.Day, (dayTotals.get(point.Day) ?? 0) + point.Value)
    }
    let maxDayTotal = 0
    for (const total of dayTotals.values()) {
      if (total > maxDayTotal) maxDayTotal = total
    }
    const yAxisMax =
      maxDayTotal > 0 ? maxDayTotal / (1 - TOP_HEADROOM_RATIO) : undefined

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
          min: 0,
          max: yAxisMax,
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
          onReady={(instance: IVChart) => {
            // onReady 在挂载与每次规格更新后都会触发：先解绑再绑定，
            // 保证同一实例上只有一个监听器
            instance.off('legendItemClick', handleLegendItemClick)
            instance.on('legendItemClick', handleLegendItemClick)
          }}
        />
      )}
    </div>
  )
}
