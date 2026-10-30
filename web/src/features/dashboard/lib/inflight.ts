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
// ============================================================================
// 实时在途请求：SSE 帧的数据模型与纯聚合函数（全部可独立单测）
// ============================================================================

/** 在途请求所处阶段：排队 = 还没发往上游，活跃 = 已发出、在等响应 */
export type InflightPhase = 'queued' | 'active'

export interface InflightRecord {
  id: string
  model: string
  username: string
  token_name: string
  channel_id: number
  channel_name: string
  /** Unix 秒 */
  start_time: number
  estimated_prompt_tokens: number
  phase: InflightPhase
}

/** SSE 一帧快照（对应后端 service/inflight.Snapshot） */
export interface InflightSnapshot {
  inflight: InflightRecord[]
  /** 模型 -> 并发上限估计（观测到的最大并发，撞上游 429 时收紧，只紧不放） */
  peaks: Record<string, number>
  total_inflight: number
  total_estimated_prompt_tokens: number
}

/** 一个模型分组的在途数据 */
export interface InflightModelGroup {
  model: string
  /** 当前在途数 */
  current: number
  /** 并发上限估计：观测到的最大并发，撞上游 429 时收紧 */
  peak: number
  records: InflightRecord[]
}

export const EMPTY_INFLIGHT_SNAPSHOT: InflightSnapshot = {
  inflight: [],
  peaks: {},
  total_inflight: 0,
  total_estimated_prompt_tokens: 0,
}

/** 节头行的 `(当前在途 - 峰值)` 文本 */
export function formatInflightCounter(group: {
  current: number
  peak: number
}): string {
  return `(${group.current}-${group.peak})`
}

/** 已进行时长（秒），用于秒级走动展示 */
export function inflightElapsedSeconds(
  record: InflightRecord,
  nowSeconds: number
): number {
  return Math.max(0, nowSeconds - record.start_time)
}

/** 时长格式：60 秒以内显示 `Ns`，以上显示 `Mm SSs` */
export function formatInflightElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  if (safe < 60) return `${safe}s`
  const minutes = Math.floor(safe / 60)
  return `${minutes}m ${safe % 60}s`
}

/**
 * 按模型把在途请求分组，供分节表格使用：
 * - 只有出现过在途或已有峰值的模型才占一节（从未出现过的模型不占位）
 * - 当前 0 在途但已有峰值的模型仍然占一节，显示 (0-峰值)
 * - 分组按「当前在途数 desc → 峰值 desc → 模型名」排序，节内按开始时间升序
 */
export function groupInflightByModel(
  snapshot: InflightSnapshot
): InflightModelGroup[] {
  const peaks = snapshot.peaks ?? {}
  const byModel = new Map<string, InflightRecord[]>()
  for (const record of snapshot.inflight ?? []) {
    const model = record.model || ''
    const bucket = byModel.get(model)
    if (bucket) {
      bucket.push(record)
    } else {
      byModel.set(model, [record])
    }
  }

  const models = new Set<string>([...byModel.keys(), ...Object.keys(peaks)])
  const groups: InflightModelGroup[] = []
  for (const model of models) {
    const records = (byModel.get(model) ?? []).sort(
      (a, b) => a.start_time - b.start_time
    )
    // 兜底：当前在途数本身就是一次观测，峰值不可能比它还低
    const peak = Math.max(peaks[model] ?? 0, records.length)
    // 没有在途也没有峰值的模型不占节
    if (records.length === 0 && peak === 0) continue
    groups.push({ model, current: records.length, peak, records })
  }

  return groups.sort(
    (a, b) =>
      b.current - a.current ||
      b.peak - a.peak ||
      a.model.localeCompare(b.model)
  )
}

/** 空状态：既没有在途请求，也没有任何模型留下过峰值 */
export function isInflightIdle(snapshot: InflightSnapshot): boolean {
  return groupInflightByModel(snapshot).length === 0
}
