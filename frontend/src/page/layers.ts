import * as Y from 'yjs'
import { readStrokes, strokesMap, type Stroke } from './doc'
import { orderStrokes } from './render'

/**
 * 레이어: 한 페이지 안에서 획을 나눠 담는 층. 페이지 문서의 layers 맵에 둔다.
 *
 * layers: Y.Map<'<layerId>/<필드>', 값>  필드: name, order, locked, opacity, deleted(기본 레이어만)
 *
 * - 레이어마다 중첩 맵을 두지 않고 필드마다 키를 둔다. 두 사람이 같은 레이어의 다른 값(이름과 잠금)을
 *   동시에 바꿔도 둘 다 남고, 같은 값은 나중 것이 남는다.
 * - 기본 레이어는 따로 만들지 않는다. deleted가 아니면 늘 있고, 값이 없으면 기본값이다.
 *   그래서 레이어를 쓰지 않는 페이지는 문서가 바뀌지 않고, 내 첫 변경을 되돌려도 공용 기본 레이어는 남는다.
 * - 다른 레이어는 order 키가 있으면 있는 것이다. 지우면 그 레이어의 키를 모두 지운다.
 * - order는 정렬 키(소수). 사이에 끼워 넣을 수 있어 동시에 순서를 바꿔도 충돌하지 않는다.
 * - 글 상자는 레이어에 속하지 않고 항상 맨 위다.
 * - 보이기/숨기기는 문서에 쓰지 않는다(사람마다 다른 화면 설정).
 */

export type Layer = { id: string; name: string; order: number; locked: boolean; opacity: number }

export const LAYERS = 'layers'
export const BASE_LAYER_ID = 'base'
export const MAX_LAYERS = 5
export const MAX_LAYER_NAME = 20

const BASE_LAYER: Layer = { id: BASE_LAYER_ID, name: '레이어 1', order: 0, locked: false, opacity: 1 }

type Field = 'name' | 'order' | 'locked' | 'opacity' | 'deleted'

export function layersMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(LAYERS)
}

const key = (id: string, field: Field) => `${id}/${field}`

function toLayer(id: string, f: Partial<Record<Field, unknown>>, fallback: Layer): Layer {
  const name = typeof f.name === 'string' && f.name ? f.name : fallback.name
  const order = typeof f.order === 'number' && Number.isFinite(f.order) ? f.order : fallback.order
  const opacity = typeof f.opacity === 'number' && Number.isFinite(f.opacity) ? Math.min(1, Math.max(0.1, f.opacity)) : 1
  return { id, name, order, locked: f.locked === true, opacity }
}

/** 레이어 목록, 아래에서 위 순서. 하나도 없으면 기본 레이어 하나. */
export function readLayers(doc: Y.Doc): Layer[] {
  const fields = new Map<string, Partial<Record<Field, unknown>>>()
  for (const [k, v] of layersMap(doc).entries()) {
    const slash = k.lastIndexOf('/')
    if (slash <= 0) continue
    const id = k.slice(0, slash)
    const rec = fields.get(id) ?? {}
    rec[k.slice(slash + 1) as Field] = v
    fields.set(id, rec)
  }
  const layers: Layer[] = []
  const base = fields.get(BASE_LAYER_ID) ?? {}
  if (base.deleted !== true) layers.push(toLayer(BASE_LAYER_ID, base, BASE_LAYER))
  for (const [id, f] of fields) {
    if (id === BASE_LAYER_ID || typeof f.order !== 'number' || !Number.isFinite(f.order)) continue
    layers.push(toLayer(id, f, { ...BASE_LAYER, id, name: '레이어' }))
  }
  // 동시에 마지막 둘을 지운 경우처럼 하나도 남지 않으면 기본 레이어로 본다.
  if (layers.length === 0) return [BASE_LAYER]
  return layers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

function newLayerId(): string {
  return `l${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
}

function nextName(layers: Layer[]): string {
  const used = layers.map((l) => /^레이어 (\d+)$/.exec(l.name)?.[1]).map(Number).filter(Boolean)
  return `레이어 ${Math.max(layers.length, ...used) + 1}`
}

/** 맨 위에 새 레이어를 만든다. 이미 MAX_LAYERS개면 null. */
export function addLayer(doc: Y.Doc, origin?: unknown): string | null {
  const layers = readLayers(doc)
  if (layers.length >= MAX_LAYERS) return null
  const id = newLayerId()
  const order = Math.max(...layers.map((l) => l.order)) + 1
  doc.transact(() => {
    const map = layersMap(doc)
    map.set(key(id, 'name'), nextName(layers))
    map.set(key(id, 'order'), order)
  }, origin)
  return id
}

/** 있는 레이어의 값을 바꾼다. 바뀌는 값의 키만 쓴다. */
function updateLayer(doc: Y.Doc, id: string, fields: Partial<Record<'name' | 'order' | 'locked' | 'opacity', unknown>>, origin?: unknown): void {
  if (!readLayers(doc).some((l) => l.id === id)) return
  doc.transact(() => {
    const map = layersMap(doc)
    for (const [k, v] of Object.entries(fields)) map.set(key(id, k as Field), v)
  }, origin)
}

export function renameLayer(doc: Y.Doc, id: string, name: string, origin?: unknown): void {
  const clean = name.trim().slice(0, MAX_LAYER_NAME)
  if (!clean) return
  updateLayer(doc, id, { name: clean }, origin)
}

export function setLayerOpacity(doc: Y.Doc, id: string, opacity: number, origin?: unknown): void {
  updateLayer(doc, id, { opacity: Math.round(Math.min(1, Math.max(0.1, opacity)) * 100) / 100 }, origin)
}

/**
 * 레이어와 그 레이어의 획(남의 획 포함)을 한 번에 지운다. 내 작업이므로 되돌리기로 함께 살아난다.
 * 마지막 남은 레이어는 지울 수 없다(false).
 */
export function deleteLayer(doc: Y.Doc, id: string, origin?: unknown): boolean {
  const layers = readLayers(doc)
  if (layers.length <= 1 || !layers.some((l) => l.id === id)) return false
  const doomed = readStrokes(doc)
    .filter((s) => layerOf(s, layers) === id)
    .map((s) => s.id)
  doc.transact(() => {
    const strokes = strokesMap(doc)
    for (const sid of doomed) strokes.delete(sid)
    const map = layersMap(doc)
    if (id === BASE_LAYER_ID) map.set(key(id, 'deleted'), true)
    else for (const k of Array.from(map.keys())) if (k.startsWith(`${id}/`)) map.delete(k)
  }, origin)
  return true
}

/** 잠그면 아무도 그 레이어에 그리거나 지우지 못한다(클라이언트에서 지킨다). 누구나 풀 수 있다. */
export function setLayerLocked(doc: Y.Doc, id: string, locked: boolean, origin?: unknown): void {
  updateLayer(doc, id, { locked }, origin)
}

/** 이 레이어에 새 획을 그릴 수 있는지(잠기지 않았는지). */
export function canDrawOn(layers: Layer[], id: string): boolean {
  return !layers.find((l) => l.id === id)?.locked
}

/** 지우개·선택이 다룰 수 있는 획: 잠긴 레이어와 내가 숨긴 레이어의 획은 뺀다. */
export function editableStrokes(strokes: Stroke[], layers: Layer[], hidden?: ReadonlySet<string>): Stroke[] {
  const blocked = new Set(layers.filter((l) => l.locked || hidden?.has(l.id)).map((l) => l.id))
  return blocked.size ? strokes.filter((s) => !blocked.has(layerOf(s, layers))) : strokes
}

/**
 * 레이어를 아래에서 index번째 자리로 옮긴다. 옮기는 레이어의 순서 키만 이웃 사이 값으로 바꾸므로
 * 두 사람이 동시에 다른 레이어를 옮겨도 합친 결과가 같다. 레이어가 하나뿐이면 아무것도 하지 않는다.
 */
export function moveLayer(doc: Y.Doc, id: string, index: number, origin?: unknown): void {
  const others = readLayers(doc).filter((l) => l.id !== id)
  if (others.length === 0) return
  const i = Math.min(Math.max(0, index), others.length)
  const below = others[i - 1]?.order
  const above = others[i]?.order
  const order = below === undefined ? above! - 1 : above === undefined ? below + 1 : (below + above) / 2
  if (!Number.isFinite(order)) return
  updateLayer(doc, id, { order }, origin)
}

/** 획이 속한 레이어. 없거나 없는 레이어를 가리키면 기본 레이어(없으면 맨 아래 레이어). */
export function layerOf(stroke: Stroke, layers: Layer[]): string {
  if (stroke.layer && layers.some((l) => l.id === stroke.layer)) return stroke.layer
  return layers.some((l) => l.id === BASE_LAYER_ID) ? BASE_LAYER_ID : layers[0].id
}

export type LayerPlanItem = { layer: Layer; strokes: Stroke[] }

/** 그릴 차례: 레이어 아래→위, 레이어 안에서는 형광펜→펜. hidden에 든 레이어는 뺀다. */
export function layerPlan(strokes: Stroke[], layers: Layer[], hidden?: ReadonlySet<string>): LayerPlanItem[] {
  const groups = new Map<string, Stroke[]>(layers.map((l) => [l.id, []]))
  for (const s of strokes) groups.get(layerOf(s, layers))!.push(s)
  return layers.filter((l) => !hidden?.has(l.id)).map((layer) => ({ layer, strokes: orderStrokes(groups.get(layer.id)!) }))
}

export type LayerStats = { count: number; authors: string[] }

/** 레이어마다 획 수와 그린 사람(닉네임). */
export function layerStats(doc: Y.Doc, layers: Layer[] = readLayers(doc)): Map<string, LayerStats> {
  const stats = new Map<string, LayerStats>(layers.map((l) => [l.id, { count: 0, authors: [] }]))
  for (const s of readStrokes(doc)) {
    const st = stats.get(layerOf(s, layers))!
    st.count++
    if (s.author && !st.authors.includes(s.author)) st.authors.push(s.author)
  }
  return stats
}

/** 레이어·획이 바뀔 때마다 부를 콜백을 건다. 돌려준 함수로 푼다. */
export function observeLayers(doc: Y.Doc, cb: () => void): () => void {
  const layers = layersMap(doc)
  const strokes = strokesMap(doc)
  layers.observe(cb)
  strokes.observeDeep(cb)
  return () => {
    layers.unobserve(cb)
    strokes.unobserveDeep(cb)
  }
}

/**
 * 선택·이동으로 잡을 획. 기본 레이어(페이지)의 획은 고른 것만, 다른 레이어는 스티커처럼 그 레이어의 획을
 * 통째로 잡는다(strokes에는 잡을 수 있는 획만 넘긴다: 잠기거나 숨긴 레이어는 빠진다).
 */
export function grabIds(ids: string[], strokes: Stroke[], layers: Layer[]): string[] {
  const picked = new Set(ids)
  const stickerLayers = new Set(
    strokes.filter((s) => picked.has(s.id)).map((s) => layerOf(s, layers)).filter((l) => l !== BASE_LAYER_ID),
  )
  if (stickerLayers.size === 0) return ids
  for (const s of strokes) if (stickerLayers.has(layerOf(s, layers))) picked.add(s.id)
  return [...picked]
}
