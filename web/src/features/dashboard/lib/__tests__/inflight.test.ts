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
import { describe, expect, test } from 'vitest'

import {
  EMPTY_INFLIGHT_SNAPSHOT,
  formatInflightCounter,
  formatInflightElapsed,
  groupInflightByModel,
  inflightElapsedSeconds,
  isInflightIdle,
  type InflightRecord,
  type InflightSnapshot,
} from '../inflight'

function record(
  id: string,
  model: string,
  overrides: Partial<InflightRecord> = {}
): InflightRecord {
  return {
    id,
    model,
    username: 'alice',
    token_name: 'primary',
    channel_id: 1,
    channel_name: 'east',
    start_time: 1_000,
    estimated_prompt_tokens: 0,
    phase: 'queued',
    ...overrides,
  }
}

function snapshot(
  inflight: InflightRecord[],
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

describe('groupInflightByModel', () => {
  test('按模型分组并带上峰值，节内按开始时间升序', () => {
    const groups = groupInflightByModel(
      snapshot(
        [
          record('b', 'gpt-4o', { start_time: 2_000 }),
          record('a', 'gpt-4o', { start_time: 1_000 }),
          record('c', 'claude', { start_time: 1_500 }),
        ],
        { 'gpt-4o': 5, claude: 2 }
      )
    )

    expect(groups.map((group) => group.model)).toEqual(['gpt-4o', 'claude'])
    expect(groups[0].records.map((item) => item.id)).toEqual(['a', 'b'])
    expect(groups[0].current).toBe(2)
    expect(groups[0].peak).toBe(5)
  })

  test('0 在途但已有峰值的模型仍占一节，显示 (0-峰值)', () => {
    const groups = groupInflightByModel(
      snapshot([], { 'gpt-4o': 7, claude: 0 })
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].model).toBe('gpt-4o')
    expect(groups[0].current).toBe(0)
    expect(groups[0].peak).toBe(7)
    expect(formatInflightCounter(groups[0])).toBe('(0-7)')
  })

  test('峰值兜底不低于当前在途数', () => {
    const groups = groupInflightByModel(
      snapshot([record('a', 'gpt-4o'), record('b', 'gpt-4o')], {
        'gpt-4o': 1,
      })
    )

    expect(groups[0].current).toBe(2)
    expect(groups[0].peak).toBe(2)
    expect(formatInflightCounter(groups[0])).toBe('(2-2)')
  })

  test('从未出现过的模型不占节', () => {
    expect(groupInflightByModel(EMPTY_INFLIGHT_SNAPSHOT)).toEqual([])
    expect(isInflightIdle(EMPTY_INFLIGHT_SNAPSHOT)).toBe(true)
  })

  test('分组按当前在途数 desc → 峰值 desc → 模型名排序', () => {
    const groups = groupInflightByModel(
      snapshot(
        [record('a', 'alpha'), record('b', 'beta'), record('c', 'gamma')],
        { alpha: 1, beta: 9, gamma: 9 }
      )
    )

    expect(groups.map((group) => group.model)).toEqual(['beta', 'gamma', 'alpha'])
  })
})

describe('formatInflightCounter', () => {
  test('渲染 (当前在途 - 峰值)', () => {
    expect(formatInflightCounter({ current: 3, peak: 12 })).toBe('(3-12)')
    expect(formatInflightCounter({ current: 0, peak: 0 })).toBe('(0-0)')
  })
})

describe('inflightElapsedSeconds / formatInflightElapsed', () => {
  test('已进行时长按秒计算且不为负', () => {
    expect(inflightElapsedSeconds(record('a', 'm'), 1_042)).toBe(42)
    // 时钟回拨时兜底为 0
    expect(inflightElapsedSeconds(record('a', 'm'), 999)).toBe(0)
  })

  test('60 秒以内显示秒，以上显示分秒', () => {
    expect(formatInflightElapsed(0)).toBe('0s')
    expect(formatInflightElapsed(59.7)).toBe('59s')
    expect(formatInflightElapsed(60)).toBe('1m 0s')
    expect(formatInflightElapsed(125)).toBe('2m 5s')
    expect(formatInflightElapsed(-5)).toBe('0s')
  })
})
