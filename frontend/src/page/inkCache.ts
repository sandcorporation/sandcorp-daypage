import type { Stroke } from './doc'
import { layerOf, type Layer, type LayerPlanItem } from './layers'
import { compareStrokes } from './render'

/**
 * 잉크 캔버스에 무엇까지 그려져 있는지. 획이 '더해지기만' 했을 때 전체(1만 획이면 0.5초)를 다시 그리지 않고
 * 새 획만 덧그리기 위한 기록이다.
 *
 * 덧그린 결과가 전체를 다시 그린 것과 같으려면 새 획이
 * (1) 지금까지 그린 가장 위 레이어이거나 그보다 위 레이어에 있고,
 * (2) 같은 레이어라면 그 레이어에서 마지막으로 그린 획보다 뒤 순서(compareStrokes)이며,
 * (3) 펜이어야 한다(형광펜은 한 덩어리로 합쳐 그리고, 채색은 다른 캔버스에 그린다). 레이어도 불투명해야 한다.
 */
export type Painted = {
  /** layers 배열에서 지금까지 그린 가장 위 레이어의 자리. 아무것도 안 그렸으면 -1 */
  layerIndex: number
  /** 그 레이어에서 마지막으로 그린 획 */
  last: Stroke | null
}

export const NOTHING_PAINTED: Painted = { layerIndex: -1, last: null }

/** 전체를 plan 순서로 다 그린 뒤의 기록. layers는 plan을 만든 레이어 목록(순서 기준). */
export function paintedAfter(plan: LayerPlanItem[], layers: Layer[]): Painted {
  for (let i = plan.length - 1; i >= 0; i--) {
    const item = plan[i]
    if (item.strokes.length === 0) continue
    return { layerIndex: layers.findIndex((l) => l.id === item.layer.id), last: item.strokes[item.strokes.length - 1] }
  }
  return NOTHING_PAINTED
}

/**
 * 더해진 획들을 덧그려도 되면 그릴 순서와 그 뒤의 기록을, 아니면 null(전체를 다시 그려야 한다).
 * 숨긴 레이어의 획은 그리지 않고 건너뛴다.
 */
export function appendPlan(
  painted: Painted,
  added: Stroke[],
  layers: Layer[],
  hidden?: ReadonlySet<string>,
): { strokes: Stroke[]; painted: Painted } | null {
  const index = new Map(layers.map((l, i) => [l.id, i]))
  const at = (s: Stroke) => index.get(layerOf(s, layers)) ?? 0
  const ordered = [...added].sort((a, b) => at(a) - at(b) || compareStrokes(a, b))
  let state = painted
  const strokes: Stroke[] = []
  for (const s of ordered) {
    const li = at(s)
    const layer = layers[li]
    if (hidden?.has(layer.id)) continue
    if (s.tool !== 'pen' || layer.opacity < 1 || li < state.layerIndex) return null
    if (li === state.layerIndex && state.last && compareStrokes(s, state.last) <= 0) return null
    strokes.push(s)
    state = { layerIndex: li, last: s }
  }
  return { strokes, painted: state }
}
