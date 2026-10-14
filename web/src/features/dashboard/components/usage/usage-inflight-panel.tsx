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
import { Activity } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  EMPTY_INFLIGHT_SNAPSHOT,
  formatInflightCounter,
  formatInflightElapsed,
  groupInflightByModel,
  inflightElapsedSeconds,
  type InflightSnapshot,
  type InflightStream,
} from '@/features/dashboard/lib'
import { subscribeInflightStream } from '@/features/dashboard/lib/inflight-stream'
import { formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

/** 时长每秒走动一次的周期 */
const TICK_INTERVAL_MS = 1_000

interface UsageInflightPanelProps {
  locale: Intl.LocalesArgument
}

/**
 * 实时在途请求面板：SSE 推送，按模型分节展示 `(当前在途 - 峰值)` 与每条在途请求。
 * 峰值由后端维护（观测到的最大并发，撞上游 429 时抬升），只增不减、重启归零。
 */
export function UsageInflightPanel(props: UsageInflightPanelProps) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<InflightSnapshot>(
    EMPTY_INFLIGHT_SNAPSHOT
  )
  const [connected, setConnected] = useState(false)
  const [hasReceivedData, setHasReceivedData] = useState(false)
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1000)
  )
  const locale = props.locale
  // 连接句柄放在 ref 里：重连按钮点击时直接调，不触发重渲染
  const streamRef = useRef<InflightStream | null>(null)

  useEffect(() => {
    const stream = subscribeInflightStream({
      onSnapshot: (next) => {
        setSnapshot(next)
        setHasReceivedData(true)
      },
      onConnectionChange: setConnected,
    })
    streamRef.current = stream
    return () => {
      stream.close()
      streamRef.current = null
    }
  }, [])

  // 时长列每秒走动
  useEffect(() => {
    const timer = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000))
    }, TICK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const groups = useMemo(() => groupInflightByModel(snapshot), [snapshot])
  const hasData = groups.length > 0

  // 首帧到达前显示骨架；有数据按模型分节；都没有则空状态
  let body = (
    <div className='space-y-2'>
      {Array.from({ length: INFLIGHT_SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} className='h-4 w-full' />
      ))}
    </div>
  )
  if (hasReceivedData) {
    body = hasData ? (
      <div className='space-y-3'>
        {groups.map((group) => (
          <div key={group.model || 'unknown'} className='min-w-0'>
            {/* 节头行：模型 ID 是该节的标识，用加粗大字 + 右侧徽标承载
                (当前在途 - 峰值)，避免模型名被下面的表头淹没 */}
            <div className='flex items-center justify-between gap-2'>
              <span
                className='min-w-0 truncate text-sm font-semibold'
                title={group.model || t('Unknown model')}
              >
                {group.model || t('Unknown model')}
              </span>
              <span className='bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums'>
                {formatInflightCounter(group)}
              </span>
            </div>
            <table className='mt-1 w-full table-auto text-xs'>
              <thead className='text-muted-foreground text-left'>
                <tr>
                  <th className='w-28 font-medium'>{t('User')}</th>
                  <th className='w-28 font-medium'>{t('Token')}</th>
                  <th className='w-20 font-medium'>{t('Channel')}</th>
                  <th className='w-16 text-right font-medium'>
                    {t('Elapsed')}
                  </th>
                  <th className='w-24 text-right font-medium'>
                    {t('Est. input')}
                  </th>
                  <th className='w-16 font-medium'>{t('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {group.records.map((record) => (
                  <tr key={record.id} className='align-middle'>
                    <td
                      className='max-w-28 truncate py-0.5'
                      title={record.username}
                    >
                      {record.username}
                    </td>
                    <td
                      className='max-w-28 truncate py-0.5'
                      title={record.token_name}
                    >
                      {record.token_name}
                    </td>
                    <td
                      className='max-w-20 truncate py-0.5'
                      title={record.channel_name}
                    >
                      {record.channel_name || '—'}
                    </td>
                    <td className='py-0.5 text-right tabular-nums'>
                      {formatInflightElapsed(
                        inflightElapsedSeconds(record, nowSeconds)
                      )}
                    </td>
                    <td className='py-0.5 text-right tabular-nums'>
                      {formatCompactNumber(
                        record.estimated_prompt_tokens,
                        locale
                      )}
                      <span className='text-muted-foreground ml-0.5'>
                        {t('est.')}
                      </span>
                    </td>
                    <td className='py-0.5'>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                          record.phase === 'active'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        )}
                      >
                        {record.phase === 'active'
                          ? t('Running')
                          : t('Waiting')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    ) : (
      <div className='text-muted-foreground flex min-h-24 items-center justify-center text-sm'>
        {t('No in-flight requests')}
      </div>
    )
  }

  return (
    <section
      className='overflow-hidden rounded-lg border'
      aria-label={t('In-flight requests')}
    >
      <header className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5 sm:py-3'>
        <div className='flex items-center gap-2'>
          <span className='bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-md'>
            <Activity className='size-3' aria-hidden='true' />
          </span>
          <div className='text-sm font-semibold'>{t('In-flight requests')}</div>
          <span className='text-muted-foreground text-xs'>
            {t('Current node only')}
          </span>
        </div>
        <div className='flex items-center gap-3 text-xs'>
          <span className='text-muted-foreground'>
            {t('In-flight')}
            <span className='ml-1 font-medium tabular-nums text-foreground'>
              {formatCompactNumber(snapshot.total_inflight, locale)}
            </span>
          </span>
          <span className='text-muted-foreground'>
            {t('Estimated input tokens')}
            <span className='ml-1 font-medium tabular-nums text-foreground'>
              {formatCompactNumber(
                snapshot.total_estimated_prompt_tokens,
                locale
              )}
            </span>
          </span>
          {!connected && (
            <div className='flex items-center gap-2'>
              <span className='text-amber-600 dark:text-amber-400'>
                {t('Connecting…')}
              </span>
              {/* 自动重连可能一直不成功（服务端没起来、反代把流掐断等），
                  给一个手动重连入口，省得刷新整个页面 */}
              <Button
                variant='outline'
                size='xs'
                onClick={() => streamRef.current?.reconnect()}
              >
                {t('Connect manually')}
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className='p-4 sm:px-5'>{body}</div>
    </section>
  )
}

/** 首帧到达前展示的骨架行数 */
const INFLIGHT_SKELETON_ROWS = 3
