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
 * Compact filter bar for the Log4 view: log type, time-range preset, model
 * name and a refresh action. Type and range apply immediately; the model
 * input applies on Enter, on blur, or when an option is picked from the
 * dropdown. The dropdown is fed by the log model-names endpoint (models with
 * request records inside the selected time range) and filtered client-side
 * by substring, so a partial model name is enough to narrow it down.
 */
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { getAllLogModelNames, getUserLogModelNames } from '../api'
import { LogsFilterField } from '../components/logs-filter-toolbar'
import { LOG_TYPE_FILTERS } from '../constants'
import type { GetLogModelNamesParams } from '../types'
import {
  LOG4_TIME_RANGE_PRESETS,
  resolveLog4TimeRange,
  type Log4TimeRangeId,
} from './lib'

interface Log4FilterBarProps {
  type: string
  rangeId: Log4TimeRangeId
  model: string
  /** True queries the admin model-names endpoint (all users' logs) */
  isAdmin: boolean
  isFetching: boolean
  onTypeChange: (type: string) => void
  onRangeChange: (rangeId: Log4TimeRangeId) => void
  onModelApply: (model: string) => void
  onRefresh: () => void
}

function toSeconds(ms: number | undefined): number | undefined {
  return ms != null ? Math.floor(ms / 1000) : undefined
}

/**
 * Render the Log4 filter bar.
 *
 * @param props.type - Current log type filter value ('0' = all types)
 * @param props.rangeId - Current time-range preset id
 * @param props.model - Applied model name filter
 * @param props.isAdmin - True uses GET /api/log/models, false the /self variant
 * @param props.isFetching - Whether any Log4 page request is in flight
 * @param props.onTypeChange - Called with the selected log type value
 * @param props.onRangeChange - Called with the selected time-range preset id
 * @param props.onModelApply - Called with the model name when confirmed
 * @param props.onRefresh - Called when the refresh button is pressed
 */
export function Log4FilterBar(props: Log4FilterBarProps) {
  const { t } = useTranslation()
  const [modelDraft, setModelDraft] = useState(props.model)
  // Fetch the model-name suggestions only while the model input is focused.
  const [modelFieldFocused, setModelFieldFocused] = useState(false)

  // Re-sync the draft when the applied filter changes elsewhere
  // (e.g. browser back/forward).
  useEffect(() => {
    setModelDraft(props.model)
  }, [props.model])

  const typeItems = LOG_TYPE_FILTERS.map((type) => ({
    value: type.value,
    label: t(type.label),
  }))
  const typeLabel =
    typeItems.find((type) => type.value === props.type)?.label ?? t('All Types')

  const rangeItems = LOG4_TIME_RANGE_PRESETS.map((preset) => ({
    value: preset.id,
    label: t(preset.label),
  }))
  const rangeLabel =
    rangeItems.find((preset) => preset.value === props.rangeId)?.label ??
    t('24 Hours')

  const applyModel = () => {
    props.onModelApply(modelDraft.trim())
  }

  const modelNamesQuery = useQuery({
    queryKey: [
      'usage-logs-log4-model-names',
      props.isAdmin,
      props.type,
      props.rangeId,
    ],
    enabled: modelFieldFocused,
    staleTime: 30_000,
    queryFn: async () => {
      const resolved = resolveLog4TimeRange(props.rangeId)
      const params: GetLogModelNamesParams = {
        type: props.type,
        start_timestamp: toSeconds(resolved.startTime),
        end_timestamp: toSeconds(resolved.endTime),
      }
      const result = props.isAdmin
        ? await getAllLogModelNames(params)
        : await getUserLogModelNames(params)
      if (!result?.success) {
        throw new Error(result?.message || t('Failed to load logs'))
      }
      return result.data ?? []
    },
  })

  const modelOptions = useMemo(
    () =>
      (modelNamesQuery.data ?? []).map((name) => ({
        value: name,
        label: name,
      })),
    [modelNamesQuery.data]
  )

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <LogsFilterField>
        <Select
          items={typeItems}
          value={props.type}
          onValueChange={(value) => {
            if (value !== null) props.onTypeChange(value)
          }}
        >
          <SelectTrigger aria-label={t('Type')}>
            <SelectValue>{typeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {LOG_TYPE_FILTERS.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {t(type.label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </LogsFilterField>
      <LogsFilterField>
        <Select
          items={rangeItems}
          value={props.rangeId}
          onValueChange={(value) => {
            if (value !== null) {
              props.onRangeChange(value as Log4TimeRangeId)
            }
          }}
        >
          <SelectTrigger aria-label={t('Time Range')}>
            <SelectValue>{rangeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {LOG4_TIME_RANGE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {t(preset.label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </LogsFilterField>
      <LogsFilterField className='w-56'>
        {/* focus capture wrapper: fetch suggestions only while the input is
            focused, without teaching LogsFilterField about query state */}
        <div
          onFocusCapture={() => setModelFieldFocused(true)}
          onBlurCapture={() => setModelFieldFocused(false)}
        >
          <ComboboxInput
            options={modelOptions}
            value={modelDraft}
            onValueChange={setModelDraft}
            onSelect={(value) => props.onModelApply(value.trim())}
            onBlur={applyModel}
            showClear
            allowCustomValue
            placeholder={t('Model Name')}
            aria-label={t('Model Name')}
            emptyText={t('No results found')}
            className='w-full'
          />
        </div>
      </LogsFilterField>
      <Button
        variant='outline'
        size='icon'
        className='size-8'
        onClick={props.onRefresh}
        disabled={props.isFetching}
        aria-label={t('Refresh')}
      >
        <RefreshCw className='size-4' aria-hidden='true' />
      </Button>
    </div>
  )
}
