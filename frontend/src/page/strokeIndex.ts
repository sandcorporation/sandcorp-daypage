import { useCallback, useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { readStroke, readStrokes, strokesMap, type Stroke } from './doc'
import { strokeBounds, type Rect } from './hit'

/** 격자 한 칸(장 좌표 px). 장(1600×2400)이 16×24칸이 된다. */
export const INDEX_CELL = 100

/**
 * 획의 공간 색인: 장을 격자로 나눠 칸마다 경계 상자가 걸치는 획 id를 둔다.
 * 지우개·선택처럼 '이 근처의 획'만 보면 되는 판정이 획 수에 비례해 느려지지 않게 한다(1만 획: 매 이동 56ms → 수 ms).
 * 경계 상자(굵기 포함) 기준이라 후보일 뿐이고, 정확한 판정은 부른 쪽이 한다.
 */
export class StrokeIndex {
  private cells = new Map<string, Set<string>>()
  private placed = new Map<string, string[]>()
  private cell: number

  constructor(cell = INDEX_CELL) {
    this.cell = cell
  }

  get size(): number {
    return this.placed.size
  }

  /** 획을 넣거나(이미 있으면) 자리를 고친다 */
  set(stroke: Stroke): void {
    this.remove(stroke.id)
    const keys = this.keysOf(strokeBounds(stroke))
    for (const k of keys) {
      let ids = this.cells.get(k)
      if (!ids) this.cells.set(k, (ids = new Set()))
      ids.add(stroke.id)
    }
    this.placed.set(stroke.id, keys)
  }

  remove(id: string): void {
    const keys = this.placed.get(id)
    if (!keys) return
    for (const k of keys) {
      const ids = this.cells.get(k)
      ids?.delete(id)
      if (ids?.size === 0) this.cells.delete(k)
    }
    this.placed.delete(id)
  }

  /** rect와 겹칠 수 있는 획 id(중복 없이) */
  near(rect: Rect): string[] {
    const out = new Set<string>()
    for (const k of this.keysOf(rect)) for (const id of this.cells.get(k) ?? []) out.add(id)
    return [...out]
  }

  private keysOf(r: Rect): string[] {
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return []
    const x0 = Math.floor(r.x / this.cell)
    const y0 = Math.floor(r.y / this.cell)
    const x1 = Math.floor((r.x + r.width) / this.cell)
    const y1 = Math.floor((r.y + r.height) / this.cell)
    const keys: string[] = []
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`)
    return keys
  }
}

/** 한 번에 이보다 많은 획이 바뀌면 고치지 않고 다음에 쓸 때 새로 만든다 */
const REBUILD_OVER = 500

export function buildStrokeIndex(strokes: Stroke[], cell = INDEX_CELL): StrokeIndex {
  const index = new StrokeIndex(cell)
  for (const s of strokes) index.set(s)
  return index
}

/**
 * 문서의 획 색인을 유지한다. 처음 쓸 때 전체를 만들고, 그 뒤로는 바뀐 획만 고친다.
 * 돌려주는 함수로 지금 색인을 얻는다(렌더와 무관하게 포인터 이벤트마다 부른다).
 */
export function useStrokeIndex(doc: Y.Doc): () => StrokeIndex {
  const ref = useRef<{ doc: Y.Doc; index: StrokeIndex } | null>(null)
  const get = useCallback(() => {
    if (ref.current?.doc !== doc) ref.current = { doc, index: buildStrokeIndex(readStrokes(doc)) }
    return ref.current.index
  }, [doc])
  useEffect(() => {
    const map = strokesMap(doc)
    const upsert = (index: StrokeIndex, id: string) => {
      const m = map.get(id)
      if (m) index.set(readStroke(id, m))
      else index.remove(id)
    }
    const onChange = (events: Y.YEvent<Y.Map<unknown>>[]) => {
      // 아직 쓴 적이 없으면 처음 쓸 때 만든다. 한꺼번에 많이 바뀌었으면(처음 받아 올 때 등) 버리고 다음에 새로 만든다
      // (1만 획을 받는 동안 하나씩 고치면 그만큼 화면이 멈춘다).
      if (ref.current?.doc !== doc) return
      if (events.reduce((n, ev) => n + (ev.target === map ? ev.changes.keys.size : 1), 0) > REBUILD_OVER) {
        ref.current = null
        return
      }
      const index = ref.current.index
      for (const ev of events) {
        if (ev.target === map) {
          for (const [id, change] of ev.changes.keys) change.action === 'delete' ? index.remove(id) : upsert(index, id)
        } else if (typeof ev.path[0] === 'string') {
          upsert(index, ev.path[0])
        }
      }
    }
    map.observeDeep(onChange)
    return () => map.unobserveDeep(onChange)
  }, [doc, get])
  return get
}
