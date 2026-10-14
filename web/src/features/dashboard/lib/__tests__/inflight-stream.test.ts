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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { InflightSnapshot } from '../inflight'
import { subscribeInflightStream } from '../inflight-stream'

const authHeadersMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth-session', () => ({
  getFreshAuthHeaders: authHeadersMock,
}))

function snapshotFrame(payload: unknown): string {
  return `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`
}

/** 把若干 SSE 帧打包成一次流式读取的 chunk */
function encodeFrames(frames: string[]): Uint8Array {
  return new TextEncoder().encode(frames.join(''))
}

/** 构造一个可手动推数据的 Response.body */
function createBodyStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
  })
  return {
    body,
    push(text: string) {
      controller.enqueue(encodeFrames([text]))
    },
    close() {
      controller.close()
    },
    /** 让挂起的 read() 立刻 reject，模拟连接在读取过程中断开 */
    fail(error: unknown) {
      controller.error(error)
    },
  }
}

function mockFetchOnce(stream: ReturnType<typeof createBodyStream>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    body: stream.body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 刷新微任务（fake timers 下不用 waitFor，避免它替你推进定时器） */
async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
  }
}

const sampleSnapshot: InflightSnapshot = {
  inflight: [],
  peaks: {},
  total_inflight: 0,
  total_estimated_prompt_tokens: 0,
}

beforeEach(() => {
  authHeadersMock.mockReset()
  authHeadersMock.mockResolvedValue({ Authorization: 'Bearer token' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('subscribeInflightStream', () => {
  test('带 Authorization 头连接并解析 snapshot 帧', async () => {
    const stream = createBodyStream()
    const fetchMock = mockFetchOnce(stream)
    const onSnapshot = vi.fn()
    const onConnectionChange = vi.fn()

    const subscription = subscribeInflightStream({
      onSnapshot,
      onConnectionChange,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer token',
      Accept: 'text/event-stream',
    })

    stream.push(snapshotFrame(sampleSnapshot))
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(1))
    expect(onSnapshot.mock.calls[0][0]).toEqual(sampleSnapshot)
    expect(onConnectionChange).toHaveBeenCalledWith(true)

    subscription.close()
  })

  test('跨 chunk 的半帧会缓存到边界拼齐后再解析', async () => {
    const stream = createBodyStream()
    mockFetchOnce(stream)
    const onSnapshot = vi.fn()

    const subscription = subscribeInflightStream({ onSnapshot })
    await vi.waitFor(() => expect(stream.body).toBeTruthy())

    stream.push('event: snapshot\ndata: {"total_in')
    await Promise.resolve()
    expect(onSnapshot).not.toHaveBeenCalled()

    stream.push('flight":3,"inflight":[]}\n\n')
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(1))
    expect(onSnapshot.mock.calls[0][0].total_inflight).toBe(3)

    subscription.close()
  })

  test('心跳注释帧不产生快照，但保持连接', async () => {
    const stream = createBodyStream()
    mockFetchOnce(stream)
    const onSnapshot = vi.fn()
    const onConnectionChange = vi.fn()

    const subscription = subscribeInflightStream({
      onSnapshot,
      onConnectionChange,
    })
    await vi.waitFor(() => expect(stream.body).toBeTruthy())

    stream.push(': ping\n\n')
    await Promise.resolve()
    expect(onSnapshot).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()

    subscription.close()
  })

  test('流结束后自动重连并退避', async () => {
    vi.useFakeTimers()
    const first = createBodyStream()
    const second = createBodyStream()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: first.body })
      .mockResolvedValueOnce({ ok: true, body: second.body })
    vi.stubGlobal('fetch', fetchMock)
    const onConnectionChange = vi.fn()

    const subscription = subscribeInflightStream({ onSnapshot: vi.fn(), onConnectionChange })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    first.close()
    await flushMicrotasks()
    expect(onConnectionChange).toHaveBeenCalledWith(false)

    // 首次重连延迟 1s，未到时间不重连
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    subscription.close()
  })

  test('长时间没有帧（含心跳）时主动断开并重连', async () => {
    vi.useFakeTimers()
    const first = createBodyStream()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: first.body })
      .mockResolvedValue({ ok: true, body: createBodyStream().body })
    vi.stubGlobal('fetch', fetchMock)

    const subscription = subscribeInflightStream({ onSnapshot: vi.fn() })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 45 秒无任何帧 → 判死：中止当前连接后走 1s 重连
    await vi.advanceTimersByTimeAsync(45_000)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    subscription.close()
  })

  test('close 后不再重连', async () => {
    vi.useFakeTimers()
    const stream = createBodyStream()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: stream.body })
    vi.stubGlobal('fetch', fetchMock)

    const subscription = subscribeInflightStream({ onSnapshot: vi.fn() })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    subscription.close()
    stream.close()
    await vi.advanceTimersByTimeAsync(60_000)
    await flushMicrotasks()

    // 卸载后的手动重连同样不能发起连接
    subscription.reconnect()
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('响应非 2xx 时走重连', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, body: null })
    vi.stubGlobal('fetch', fetchMock)

    const subscription = subscribeInflightStream({ onSnapshot: vi.fn() })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    subscription.close()
  })

  test('手动重连立即发起新连接，不等退避计时器', async () => {
    vi.useFakeTimers()
    const first = createBodyStream()
    const second = createBodyStream()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: first.body })
      .mockResolvedValueOnce({ ok: true, body: second.body })
    vi.stubGlobal('fetch', fetchMock)

    const subscription = subscribeInflightStream({ onSnapshot: vi.fn() })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    subscription.reconnect()
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // 被顶掉的旧连接不再自行安排重连：退避周期内不会多出连接
    // （窗口取 10s：够覆盖 1s 起的退避，又短于 45s 判死）
    await vi.advanceTimersByTimeAsync(10_000)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    subscription.close()
  })

  test('被顶掉的旧连接出错时不再安排重连', async () => {
    vi.useFakeTimers()
    const first = createBodyStream()
    const second = createBodyStream()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: first.body })
      .mockResolvedValueOnce({ ok: true, body: second.body })
    vi.stubGlobal('fetch', fetchMock)

    const subscription = subscribeInflightStream({ onSnapshot: vi.fn() })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    subscription.reconnect()
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // 旧连接的读循环此刻才失败：它已被顶掉，不能再触发一次重连把新连接挤掉
    first.fail(new Error('stale connection died'))
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(10_000)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    subscription.close()
  })

  test('连接失败后重连换用未中止的新信号，并能继续收到快照', async () => {
    vi.useFakeTimers()
    const first = createBodyStream()
    const second = createBodyStream()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: first.body })
      .mockResolvedValueOnce({ ok: true, body: second.body })
    vi.stubGlobal('fetch', fetchMock)
    const onSnapshot = vi.fn()

    const subscription = subscribeInflightStream({ onSnapshot })
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 读帧时连接断开：走 1s 退避重连
    first.fail(new Error('connection reset'))
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1_000)
    await flushMicrotasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 复用已中止的信号会让重连的 fetch 立刻失败，只能刷新页面才能恢复
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(false)

    second.push(snapshotFrame({ ...sampleSnapshot, total_inflight: 7 }))
    await flushMicrotasks()
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot.mock.calls[0][0].total_inflight).toBe(7)

    subscription.close()
  })
})
