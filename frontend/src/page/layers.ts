import * as Y from 'yjs'
import { readStrokes, strokesMap, type Stroke } from './doc'
import { orderStrokes } from './render'

/**
 * 레이어: 한 페이지 안에서 획을 나눠 담는 층. 페이지 문서의 layers 맵에 둔다.
 *
 * layers: Y.Map<layerId, Y.Map{ name, order, locked, opacity }>
 *
 * - 맵이 비어 있으면 기본 레이어 하나가 있는 것으로 본다. 처음 바꿀 때 기본 레이어를 함께 쓴다
 *   (그래서 레이어를 쓰지 않는 페이지는 문서가 바뀌지 않는다).
 * - order는 정렬 키(소수). 사이에 끼워 넣을 수 있어 동시에 순서를 바꿔도 충돌하지 않는다.
 * - 글 상자는 레이어에 속하지 않고 항상 맨 위다.
 * - 보이기/숨기기는 문서에 쓰지 않는다(사람마다 다른 화면 설정).
 */

export type Layer = { id: string; name: string; order: number; locked: boolean; opacity: number }

export const LAYERS = 'layers'
export const BASE_LAYER_ID = 'base'
export const MAX_LAYERS = 5

const BASE_LAYER: Layer = { id: BASE_LAYER_ID, name: '레이어 1', order: 0, locked: false, opacity: 1 }

export function layersMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(LAYERS)
}

function readLayer(id: string, m: Y.Map<unknown>): Layer {
  const opacity = m.get('opacity')
  return {
    id,
    name: (m.get('name') as string) ?? '레이어',
    order: (m.get('order') as number) ?? 0,
    locked: m.get('locked') === true,
    opacity: typeof opacity === 'number' ? Math.min(1, Math.max(0.1, opacity)) : 1,
  }
}

/** 레이어 목록, 아래에서 위 순서. 비어 있으면 기본 레이어 하나. */
export function readLayers(doc: Y.Doc): Layer[] {
  const map = layersMap(doc)
  if (map.size === 0) return [BASE_LAYER]
  return Array.from(map.entries())
    .map(([id, m]) => readLayer(id, m))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

function writeLayer(map: Y.Map<Y.Map<unknown>>, layer: Layer): void {
  const m = new Y.Map<unknown>()
  m.set('name', layer.name)
  m.set('order', layer.order)
  m.set('locked', layer.locked)
  m.set('opacity', layer.opacity)
  map.set(layer.id, m)
}

/** 레이어를 처음 바꿀 때 기본 레이어를 문서에 쓴다(트랜잭션 안에서 부른다). */
function ensureLayers(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  const map = layersMap(doc)
  if (map.size === 0) writeLayer(map, BASE_LAYER)
  return map
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
    writeLayer(ensureLayers(doc), { id, name: nextName(layers), order, locked: false, opacity: 1 })
  }, origin)
  return id
}

/** 레이어 하나의 값을 바꾼다(기본 레이어만 있던 페이지면 먼저 기본 레이어를 쓴다). */
function updateLayer(doc: Y.Doc, id: string, fields: Partial<Omit<Layer, 'id'>>, origin?: unknown): void {
  doc.transact(() => {
    const m = ensureLayers(doc).get(id)
    if (!m) return
    for (const [k, v] of Object.entries(fields)) m.set(k, v)
  }, origin)
}

export const MAX_LAYER_NAME = 20

export function renameLayer(doc: Y.Doc, id: string, name: string, origin?: unknown): void {
  const clean = name.trim().slice(0, MAX_LAYER_NAME)
  if (!clean) return
  updateLayer(doc, id, { name: clean }, origin)
}

export function setLayerOpacity(doc: Y.Doc, id: string, opacity: number, origin?: unknown): void {
  updateLayer(doc, id, { opacity: Math.round(Math.min(1, Math.max(0.1, opacity)) * 100) / 100 }, origin)
}

/**
 * 레이어를 아래에서 index번째 자리로 옮긴다. 옮기는 레이어의 순서 키만 이웃 사이 값으로 바꾸므로
 * 두 사람이 동시에 다른 레이어를 옮겨도 합친 결과가 같다.
 */
export function moveLayer(doc: Y.Doc, id: string, index: number, origin?: unknown): void {
  const others = readLayers(doc).filter((l) => l.id !== id)
  const i = Math.min(Math.max(0, index), others.length)
  const below = others[i - 1]?.order
  const above = others[i]?.order
  const order = below === undefined ? above! - 1 : above === undefined ? below + 1 : (below + above) / 2
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
  layers.observeDeep(cb)
  strokes.observeDeep(cb)
  return () => {
    layers.unobserveDeep(cb)
    strokes.unobserveDeep(cb)
  }
}
