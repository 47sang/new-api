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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { InflightSnapshot } from '@/features/dashboard/lib'

import { UsageInflightPanel } from '../usage-inflight-panel'

const streamMock = vi.hoisted(() => vi.fn())

vi.mock('@/features/dashboard/lib/inflight-stream', () => ({
  subscribeInflightStream: streamMock,
}))

function snapshot(
  inflight: InflightSnapshot['inflight'],
  peaks: Record<string, number> = {}
): InflightSnapshot {
  return {
    inflight,
    peaks,
    total_inflight: inflight.length,
    total_estimated_prompt_tokens: inflight.reduce(
      (sum, item) => sum + item.estimated_prompt_tokens,
      0
    ),
  }
}

function record(id: string, model: string) {
  return {
    id,
    model,
    username: 'alice',
    token_name: 'primary',
    channel_id: 1,
    channel_name: 'east',
    start_time: Math.floor(Date.now() / 1000) - 5,
    estimated_prompt_tokens: 1234,
    phase: 'active' as const,
  }
}

/** 捕获订阅参数，供测试手动推送快照 */
function captureSubscription() {
  let handlers: {
    onSnapshot: (next: InflightSnapshot) => void
    onConnectionChange?: (connected: boolean) => void
  } | null = null
  const reconnect = vi.fn()
  streamMock.mockImplementation((next: typeof handlers) => {
    handlers = next
    return { close: vi.fn(), reconnect }
  })
  return {
    push(next: InflightSnapshot) {
      act(() => {
        handlers?.onSnapshot(next)
      })
    },
    setConnected(connected: boolean) {
      act(() => {
        handlers?.onConnectionChange?.(connected)
      })
    },
    reconnect,
  }
}

beforeEach(() => {
  streamMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UsageInflightPanel', () => {
  test('首帧到达前显示加载骨架，不展示空状态', () => {
    captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('No in-flight requests')).toBeNull()
  })

  test('按模型分节展示 (当前在途 - 峰值) 与汇总数', () => {
    const sub = captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    sub.push(
      snapshot(
        [record('a', 'gpt-4o'), record('b', 'claude')],
        { 'gpt-4o': 9 }
      )
    )

    expect(screen.getByText('In-flight requests')).toBeTruthy()
    // 汇总：在途 2、预计输入 2468（紧凑格式 2.5K）
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('2.5K')).toBeTruthy()
    // 分节：gpt-4o 有在途与峰值，claude 只有在途
    expect(screen.getByText('gpt-4o')).toBeTruthy()
    expect(screen.getByText('(1-9)')).toBeTruthy()
    expect(screen.getByText('claude')).toBeTruthy()
    expect(screen.getByText('(1-1)')).toBeTruthy()
    // 明细行字段（两条在途请求，用户/渠道/状态各出现两次）
    expect(screen.getAllByText('alice')).toHaveLength(2)
    expect(screen.getAllByText('east')).toHaveLength(2)
    expect(screen.getAllByText('Running')).toHaveLength(2)
    // 估算标注
    expect(screen.getAllByText('est.').length).toBeGreaterThan(0)
  })

  test('空闲但有峰值的模型仍占一节', () => {
    const sub = captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    sub.push(snapshot([], { 'gpt-4o': 12 }))

    expect(screen.getByText('(0-12)')).toBeTruthy()
    expect(screen.queryByText('No in-flight requests')).toBeNull()
  })

  test('既无在途也无峰值时显示空状态', () => {
    const sub = captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    sub.push(snapshot([]))

    expect(screen.getByText('No in-flight requests')).toBeTruthy()
  })

  test('排队中的请求显示等待状态', () => {
    const sub = captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    sub.push(
      snapshot([
        {
          ...record('a', 'gpt-4o'),
          phase: 'queued',
          channel_name: '',
        },
      ])
    )

    expect(screen.getByText('Waiting')).toBeTruthy()
    expect(screen.queryByText('Running')).toBeNull()
    // 没有渠道名时显示占位符
    expect(screen.getByText('—')).toBeTruthy()
  })

  test('断线时保留上次快照并提示连接中', async () => {
    const sub = captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    sub.push(snapshot([record('a', 'gpt-4o')]))
    sub.setConnected(false)

    await waitFor(() => {
      expect(screen.getByText('Connecting…')).toBeTruthy()
    })
    // 快照不清空
    expect(screen.getByText('gpt-4o')).toBeTruthy()
  })

  test('断线时显示手动连接按钮，点击后触发重连', async () => {
    const user = userEvent.setup()
    const sub = captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    sub.push(snapshot([record('a', 'gpt-4o')]))
    sub.setConnected(false)

    await user.click(screen.getByRole('button', { name: 'Connect manually' }))

    expect(sub.reconnect).toHaveBeenCalledTimes(1)
  })

  test('连接恢复正常后手动连接按钮消失', async () => {
    const sub = captureSubscription()
    render(<UsageInflightPanel locale='en-US' />)

    sub.setConnected(false)
    expect(
      screen.getByRole('button', { name: 'Connect manually' })
    ).toBeTruthy()

    sub.setConnected(true)

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Connect manually' })
      ).toBeNull()
    })
    expect(screen.queryByText('Connecting…')).toBeNull()
  })

  test('卸载时关闭流', () => {
    const close = vi.fn()
    streamMock.mockImplementation(() => ({ close }))
    const { unmount } = render(<UsageInflightPanel locale='en-US' />)

    unmount()

    expect(close).toHaveBeenCalledTimes(1)
  })
})
