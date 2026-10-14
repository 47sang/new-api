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
import { getFreshAuthHeaders } from '@/lib/auth-session'

import {
  EMPTY_INFLIGHT_SNAPSHOT,
  type InflightSnapshot,
} from './inflight'

/** 重连退避：1s → 2s → 4s … 上限 30s */
const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000
/** 超过这个时间没收到任何帧（含心跳）就判定连接已死，主动重连 */
const IDLE_TIMEOUT_MS = 45_000

export interface InflightStreamHandlers {
  onSnapshot: (snapshot: InflightSnapshot) => void
  /** 连接状态变化：true = 已连接（收到过数据） */
  onConnectionChange?: (connected: boolean) => void
}

export interface InflightStream {
  close: () => void
  /** 手动重连：立刻顶掉当前连接重新发起，不等退避计时器 */
  reconnect: () => void
}

/** 一次连接尝试：控制器只属于这一条连接，被顶掉后不再参与重连调度 */
interface ConnectionAttempt {
  controller: AbortController
  superseded: boolean
}

/**
 * 订阅在途请求 SSE 流。
 *
 * 控制台接口只认 Authorization 头，而浏览器原生 EventSource 无法带自定义头，
 * 因此这里用 fetch + 流式读取自己解析 SSE 帧，顺带自己掌握重连与判死逻辑。
 */
export function subscribeInflightStream(
  handlers: InflightStreamHandlers
): InflightStream {
  let closed = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  /** 最近一次连接尝试；新尝试会顶掉它，保证同时只有一条连接 */
  let current: ConnectionAttempt | undefined

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (idleTimer) clearTimeout(idleTimer)
    reconnectTimer = undefined
    idleTimer = undefined
  }

  // 判死：超时未收到任何帧就让 read() 立刻抛出，同时中止 fetch 释放连接。
  // 不单纯依赖 abort 传播到底层流——不同浏览器/反代行为不一致。
  const armIdleTimeout = (attempt: ConnectionAttempt, onIdle: () => void) => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      attempt.controller.abort()
      onIdle()
    }, IDLE_TIMEOUT_MS)
  }

  const scheduleReconnect = (attempt: ConnectionAttempt) => {
    // 被更新的连接顶掉的旧 attempt 不再安排重连，否则两条连接会互相顶掉
    if (closed || attempt.superseded) return
    handlers.onConnectionChange?.(false)
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt
    )
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      void connect()
    }, delay)
  }

  const connect = async () => {
    if (closed) return
    // 每次连接都换一个新控制器。已中止的信号无法复用，否则本次失败之后
    // 的所有 fetch 都会立刻拒绝，自动重连和手动重连一起失效，只能刷新页面。
    if (current) {
      current.superseded = true
      current.controller.abort()
    }
    const attempt: ConnectionAttempt = {
      controller: new AbortController(),
      superseded: false,
    }
    current = attempt
    try {
      const headers = await getFreshAuthHeaders()
      if (closed) return
      const response = await fetch('/api/inflight/stream', {
        headers: { Accept: 'text/event-stream', ...headers },
        signal: attempt.controller.signal,
        cache: 'no-store',
      })
      if (!response.ok || !response.body) {
        scheduleReconnect(attempt)
        return
      }
      // 连上了：重置退避
      reconnectAttempt = 0

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      // 每次连接一个一次性的判死 promise：触发即让本轮的 read() 抛出
      let failOnIdle: (() => void) | undefined
      const idleGuard = new Promise<never>((_resolve, reject) => {
        failOnIdle = () => reject(new Error('inflight stream idle timeout'))
      })
      const touch = () => {
        if (failOnIdle) armIdleTimeout(attempt, failOnIdle)
      }
      touch()

      for (;;) {
        const { done, value } = await Promise.race([reader.read(), idleGuard])
        if (done) break
        touch()
        buffer += decoder.decode(value, { stream: true })
        // SSE 帧以空行分隔
        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          handleFrame(frame, touch)
          boundary = buffer.indexOf('\n\n')
        }
      }
      // 流正常结束（服务端关闭）：重连
      scheduleReconnect(attempt)
    } catch {
      // 判死超时 / abort / 网络错误都走重连；卸载后 closed 为 true 直接返回
      attempt.controller.abort()
      scheduleReconnect(attempt)
    }
  }

  const handleFrame = (frame: string, touch: () => void) => {
    // 心跳注释帧只用来续命
    if (frame.startsWith(':')) {
      touch()
      return
    }
    let event = ''
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim())
      }
    }
    if (dataLines.length === 0) return
    touch()
    if (event !== 'snapshot') return
    try {
      const snapshot = JSON.parse(dataLines.join('\n')) as InflightSnapshot
      handlers.onConnectionChange?.(true)
      handlers.onSnapshot(snapshot)
    } catch {
      // 单帧解析失败不影响后续帧
    }
  }

  void connect()

  return {
    close: () => {
      closed = true
      clearTimers()
      current?.controller.abort()
    },
    reconnect: () => {
      if (closed) return
      clearTimers()
      // 手动重连是用户主动行为：重置退避，立刻重发
      reconnectAttempt = 0
      void connect()
    },
  }
}

export { EMPTY_INFLIGHT_SNAPSHOT }
