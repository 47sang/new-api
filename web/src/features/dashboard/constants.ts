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
import type { DashboardChartPreferences, DashboardFilters } from './types'

export const TIME_GRANULARITY_STORAGE_KEY = 'data_export_default_time'
export const DASHBOARD_CHART_PREFERENCES_STORAGE_KEY =
  'dashboard_models_chart_preferences'
export const DEFAULT_TIME_GRANULARITY = 'hour' as const
export const MAX_CHART_TREND_POINTS = 7

export const DEFAULT_DASHBOARD_CHART_PREFERENCES: DashboardChartPreferences = {
  consumptionDistributionChart: 'bar',
  modelAnalyticsChart: 'trend',
  defaultTimeRangeDays: 1,
  defaultTimeGranularity: DEFAULT_TIME_GRANULARITY,
}

export const TIME_RANGE_BY_GRANULARITY = {
  hour: 1,
  day: 7,
  week: 30,
} as const

export const TIME_GRANULARITY_OPTIONS = [
  { label: 'Hour', value: 'hour' },
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
] as const

export const TIME_RANGE_PRESETS = [
  { label: '1 Day', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '14 Days', days: 14 },
  { label: '29 Days', days: 29 },
] as const

export const CONSUMPTION_DISTRIBUTION_CHART_OPTIONS = [
  { value: 'bar', labelKey: 'Bar Chart' },
  { value: 'area', labelKey: 'Area Chart' },
] as const

// 用量分析页（管理员）全局指标切换项，全页模块跟随联动
export const USAGE_METRIC_OPTIONS = [
  { value: 'tokens', labelKey: 'Tokens' },
  { value: 'spend', labelKey: 'Spend' },
  { value: 'requests', labelKey: 'Requests' },
] as const

// 用量分析页时间范围预设（天）
export const USAGE_TIME_RANGE_OPTIONS = [
  { value: 7, labelKey: 'Last 7 Days' },
  { value: 30, labelKey: 'Last 30 Days' },
  { value: 90, labelKey: 'Last 90 Days' },
] as const

// 热力图 5 档格子颜色：0 空档 + 4 深浅档
export const USAGE_HEATMAP_LEVEL_CLASSES = [
  'bg-muted',
  'bg-chart-1/35',
  'bg-chart-1/60',
  'bg-chart-1/85',
  'bg-chart-1',
] as const

export const MODEL_ANALYTICS_CHART_OPTIONS = [
  { value: 'trend', labelKey: 'Call Trend' },
  { value: 'proportion', labelKey: 'Call Count Distribution' },
  { value: 'top', labelKey: 'Call Count Ranking' },
] as const

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  start_timestamp: undefined,
  end_timestamp: undefined,
  time_granularity: 'hour',
  username: '',
}
