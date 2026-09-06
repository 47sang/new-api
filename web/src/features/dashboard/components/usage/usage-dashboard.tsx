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
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getDailyQuotaDates } from '@/features/dashboard/api'
import {
  buildDailyModelSeries,
  buildModelColors,
  computePeriodComparison,
  computeTopModels,
  summarizeMetric,
} from '@/features/dashboard/lib'
import type { DailyUsageItem, UsageMetric } from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { toStartOfDay } from '@/lib/time'

import { UsageActivityHeatmap } from './usage-activity-heatmap'
import { UsageSummaryCard } from './usage-summary-card'

const DAY_SECONDS = 86400

/**
 * 后端返回的 created_at 是「本地日 0 点伪时间戳 = 真实时刻 + tz_offset」，
 * 此处统一归一化为真实本地日 0 点（秒），与页面内 todayStart/rangeStart
 * 的口径一致，供按天聚合与热力图格子匹配
 */
function normalizeDailyRows(rows: DailyUsageItem[], tzOffset: number) {
  return (rows ?? []).map((row) => ({
    ...row,
    created_at: row.created_at - tzOffset,
  }))
}

/**
 * 用量分析页入口（仅管理员）：管理时间范围与指标两个全局状态，
 * 拉取「主窗口（含环比）」与「热力图近一年」两路独立数据并派生各模块所需数据
 */
export function UsageDashboard() {
  const { t, i18n } = useTranslation()
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(7)
  const [metric, setMetric] = useState<UsageMetric>('tokens')

  const otherLabel = t('Other')
  const locale = toIntlLocale(i18n.language)
  const tzOffset = useMemo(() => -new Date().getTimezoneOffset() * 60, [])

  // 天级基准随日期翻转（dayBucket 变化触发重新拉取），避免每次渲染抖动
  const { todayStart, rangeStart, queryStart, dayBucket } = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000)
    const today = toStartOfDay(nowSec)
    const start = today - (rangeDays - 1) * DAY_SECONDS
    return {
      todayStart: today,
      rangeStart: start,
      queryStart: start - rangeDays * DAY_SECONDS,
      dayBucket: Math.floor(nowSec / DAY_SECONDS),
    }
  }, [rangeDays])

  const mainQuery = useQuery({
    queryKey: ['usage-analytics-main', rangeDays, dayBucket],
    queryFn: async ({ signal }) => {
      const res = await getDailyQuotaDates(
        {
          start_timestamp: queryStart,
          end_timestamp: todayStart + DAY_SECONDS - 1,
          tz_offset: tzOffset,
          with_models: true,
        },
        signal
      )
      return normalizeDailyRows(res.data, tzOffset)
    },
    placeholderData: (previousData) => previousData,
    // 认证轮换的偶发竞态（401 → refresh 已在拦截器完成）自动重试一次，无需手动点击
    retry: 1,
    retryDelay: 300,
  })

  const yearQuery = useQuery({
    queryKey: ['usage-analytics-year', dayBucket],
    queryFn: async ({ signal }) => {
      const res = await getDailyQuotaDates(
        {
          start_timestamp: todayStart - 364 * DAY_SECONDS,
          end_timestamp: todayStart + DAY_SECONDS - 1,
          tz_offset: tzOffset,
          with_models: false,
        },
        signal
      )
      return normalizeDailyRows(res.data, tzOffset)
    },
    placeholderData: (previousData) => previousData,
    retry: 1,
    retryDelay: 300,
  })

  const mainRows = useMemo(() => mainQuery.data ?? [], [mainQuery.data])
  const currentRows = useMemo(
    () => mainRows.filter((row) => row.created_at >= rangeStart),
    [mainRows, rangeStart]
  )
  const previousRows = useMemo(
    () =>
      mainRows.filter(
        (row) => row.created_at >= queryStart && row.created_at < rangeStart
      ),
    [mainRows, queryStart, rangeStart]
  )

  const summary = summarizeMetric(currentRows, metric)
  const previousSummary = summarizeMetric(previousRows, metric)
  const change = computePeriodComparison(summary, previousSummary)

  const colorMap = useMemo(
    () => buildModelColors(currentRows, metric, otherLabel),
    [currentRows, metric, otherLabel]
  )
  const series = useMemo(
    () =>
      buildDailyModelSeries(currentRows, metric, {
        startDayTs: rangeStart,
        todayStart,
        otherLabel,
        colorMap,
      }),
    [currentRows, metric, rangeStart, todayStart, otherLabel, colorMap]
  )
  const topModels = useMemo(
    () => computeTopModels(currentRows, metric),
    [currentRows, metric]
  )

  return (
    <div className='space-y-3 sm:space-y-4'>
      <UsageSummaryCard
        rangeDays={rangeDays}
        metric={metric}
        onRangeChange={setRangeDays}
        onMetricChange={setMetric}
        summary={summary}
        change={change}
        series={series}
        colorMap={colorMap}
        topModels={topModels}
        locale={locale}
        loading={mainQuery.isLoading}
        error={mainQuery.isError}
        onRetry={() => void mainQuery.refetch()}
        isEmpty={currentRows.length === 0}
      />
      <UsageActivityHeatmap
        metric={metric}
        rows={yearQuery.data ?? []}
        todayStart={todayStart}
        locale={locale}
        loading={yearQuery.isLoading}
        error={yearQuery.isError}
        onRetry={() => void yearQuery.refetch()}
      />
    </div>
  )
}
