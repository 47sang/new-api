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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { getSessionTurns } from '../api'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
  getFreshAuthHeaders: vi.fn(async () => ({})),
}))

const mockedGet = vi.mocked(api.get)

// getSessionTurns 的路径必须走 buildApiPath：它对非管理员已经加上 /self 前缀，
// 调用方再拼一次就会得到 /api/log/self/self/session（404）。这里直接钉住两条路径，
// 因为详情弹窗的测试 mock 掉了整个 api 模块，覆盖不到这层拼接。
describe('getSessionTurns', () => {
  beforeEach(() => {
    mockedGet.mockReset()
    mockedGet.mockResolvedValue({
      data: { success: true, message: '', data: null },
    } as never)
  })

  test('admins query /api/log/session', async () => {
    await getSessionTurns('sess-1', true)
    expect(mockedGet).toHaveBeenCalledTimes(1)
    const [path] = mockedGet.mock.calls[0]
    expect(path).toBe('/api/log/session')
  })

  test('regular users query /api/log/self/session exactly once', async () => {
    await getSessionTurns('sess-1', false)
    expect(mockedGet).toHaveBeenCalledTimes(1)
    const [path] = mockedGet.mock.calls[0]
    expect(path).toBe('/api/log/self/session')
  })

  test('sends the session id as the query parameter', async () => {
    await getSessionTurns('sess-abc', false)
    const [, config] = mockedGet.mock.calls[0]
    expect((config as { params: { session_id: string } }).params.session_id).toBe(
      'sess-abc'
    )
  })
})
