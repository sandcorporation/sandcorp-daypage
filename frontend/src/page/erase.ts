import type { Stroke } from './doc'
import type { Point } from './geometry'

/**
 * 지우개 방식.
 * - range(범위): 지나간 부분만 지운다. 획을 지운 자리에서 잘라 남은 조각을 새 획으로 둔다.
 * - stroke(획): 닿은 획을 통째로 지운다.
 * - lasso(올가미): 손으로 둘러싼 영역 안의(또는 올가미 선에 걸린) 획을 지운다.
 */
export type EraserMode = 'range' | 'stroke' | 'lasso'

export const ERASER_MODES: { id: EraserMode; name: string; desc: string }[] = [
  { id: 'range', name: '범위', desc: '지나간 부분만 지워요' },
  { id: 'stroke', name: '획', desc: '닿은 획을 통째로 지워요' },
  { id: 'lasso', name: '올가미', desc: '둘러싼 영역 안의 획을 지워요' },
]

export const DEFAULT_ERASER_MODE: EraserMode = 'range'

export function isEraserMode(v: unknown): v is EraserMode {
  return ERASER_MODES.some((m) => m.id === v)
}

/**
 * 지울 대상 거르기. 펜만은 펜 도구로 그린 획(펜 종류 다섯 가지와 도형, 도형도 펜 획이다),
 * 형광펜만은 형광펜 획. 채색 붓 획은 「모두」일 때만 지운다(글씨를 고칠 때도, 형광펜을 걷어 낼 때도 밑칠은 남게).
 */
export type EraseFilter = 'all' | 'pen' | 'highlighter'

export const ERASE_FILTERS: { id: EraseFilter; name: string }[] = [
  { id: 'all', name: '모두' },
  { id: 'pen', name: '펜만' },
  { id: 'highlighter', name: '형광펜만' },
]

export const DEFAULT_ERASE_FILTER: EraseFilter = 'all'

export function isEraseFilter(v: unknown): v is EraseFilter {
  return ERASE_FILTERS.some((f) => f.id === v)
}

export function matchesFilter(stroke: Stroke, filter: EraseFilter): boolean {
  return filter === 'all' || stroke.tool === filter
}

export function filterStrokes(strokes: Stroke[], filter: EraseFilter): Stroke[] {
  return filter === 'all' ? strokes : strokes.filter((s) => matchesFilter(s, filter))
}

/**
 * 범위 지우개가 자르지 않고 통째로 지우는 획: 채움이 있는 닫힌 도형(자르면 채움 모양이 깨진다)과 점 하나짜리 획.
 * 채움 없는 닫힌 도형은 테두리를 잘라도 남은 테두리가 그대로 보이므로 자른다(이음매는 이어 붙인다).
 */
export function erasesWhole(stroke: Stroke): boolean {
  return typeof stroke.fill === 'number' || stroke.points.length <= 3
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100

/** 조각(평평한 점 배열)의 길이 */
export function polylineLength(points: number[]): number {
  let len = 0
  for (let i = 3; i + 1 < points.length; i += 3) len += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2])
  return len
}

/** 경계를 찾는 이분 횟수(굵기 100px에서도 0.1px 안쪽) */
const BISECT = 12

/**
 * 획을 지우개 경로(이웃 점 사이는 선분)로 자른다. 지우개 원(반지름 radius)이 획 잉크에 닿은 자리,
 * 곧 획 중심선이 경로에서 radius + 굵기/2 안에 드는 부분을 지운다. 잘린 끝은 그 경계에서 보간한다(필압도).
 * 돌려주는 값: 닿지 않았으면 null, 아니면 남은 조각들(평평한 [x, y, 압력] 배열, 없으면 통째로 지워짐).
 * 굵기 수준(굵기의 절반, 최소 1px)보다 짧은 조각은 버린다. 닫힌 획(처음 점 = 끝 점)은 이음매에서 갈린 두 조각을 잇는다.
 */
export function cutStroke(stroke: Stroke, path: Point[], radius: number): number[][] | null {
  const pts = stroke.points
  const n = Math.floor(pts.length / 3)
  if (n === 0 || path.length === 0) return null
  const reach = radius + stroke.width / 2
  // 이 획 근처를 지나는 지우개 선분만 본다(긴 경로에서도 획마다 몇 개)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pts[i * 3])
    maxX = Math.max(maxX, pts[i * 3])
    minY = Math.min(minY, pts[i * 3 + 1])
    maxY = Math.max(maxY, pts[i * 3 + 1])
  }
  const segs: [Point, Point][] = []
  const pairs: [Point, Point][] = path.length === 1 ? [[path[0], path[0]]] : path.slice(1).map((p, i) => [path[i], p])
  for (const [c, d] of pairs) {
    if (Math.max(c.x, d.x) < minX - reach || Math.min(c.x, d.x) > maxX + reach) continue
    if (Math.max(c.y, d.y) < minY - reach || Math.min(c.y, d.y) > maxY + reach) continue
    segs.push([c, d])
  }
  if (segs.length === 0) return null
  const inside = (x: number, y: number) => {
    const q = { x, y }
    return segs.some(([c, d]) => distToSegment(q, c, d) <= reach)
  }

  if (n === 1) return inside(pts[0], pts[1]) ? [] : null

  const pieces: number[][] = []
  let cur: number[] | null = null
  let touched = false
  const at = (i: number, t: number): [number, number, number] => {
    const a = i * 3
    const b = a + 3
    return [pts[a] + (pts[b] - pts[a]) * t, pts[a + 1] + (pts[b + 1] - pts[a + 1]) * t, pts[a + 2] + (pts[b + 2] - pts[a + 2]) * t]
  }
  const boundary = (i: number, t0: number, t1: number, startInside: boolean): number[] => {
    // t0(startInside 상태)와 t1(반대 상태) 사이의 경계
    let lo = t0
    let hi = t1
    for (let k = 0; k < BISECT; k++) {
      const mid = (lo + hi) / 2
      const [x, y] = at(i, mid)
      if (inside(x, y) === startInside) lo = mid
      else hi = mid
    }
    const [x, y, p] = at(i, startInside ? hi : lo)
    return [round1(x), round1(y), round2(p)]
  }

  let wasInside = inside(pts[0], pts[1])
  if (wasInside) touched = true
  else cur = [pts[0], pts[1], pts[2]]
  // 선분 안을 지우개 폭의 1/4 간격으로 살펴 들고 나는 자리를 찾는다(긴 직선 선분 가운데를 지나가도 놓치지 않게)
  const step = Math.max(reach / 2, 0.5)
  for (let i = 0; i + 1 < n; i++) {
    const len = Math.hypot(pts[i * 3 + 3] - pts[i * 3], pts[i * 3 + 4] - pts[i * 3 + 1])
    const samples = Math.max(1, Math.ceil(len / step))
    let tPrev = 0
    for (let k = 1; k <= samples; k++) {
      const t = k / samples
      const [x, y] = k === samples ? [pts[i * 3 + 3], pts[i * 3 + 4]] : at(i, t)
      const now = inside(x, y)
      if (now !== wasInside) {
        touched = true
        const b = boundary(i, tPrev, t, wasInside)
        if (now) {
          cur?.push(...b)
          if (cur) pieces.push(cur)
          cur = null
        } else cur = [...b]
        wasInside = now
      }
      if (k === samples && !now) cur?.push(pts[i * 3 + 3], pts[i * 3 + 4], pts[i * 3 + 5])
      tPrev = t
    }
  }
  if (!touched) return null
  if (cur) pieces.push(cur)

  // 닫힌 획: 처음 조각이 처음 점에서, 끝 조각이 끝 점에서 시작·끝나면 한 조각으로 잇는다
  const closed = n > 2 && Math.hypot(pts[0] - pts[(n - 1) * 3], pts[1] - pts[(n - 1) * 3 + 1]) < 1
  if (closed && pieces.length >= 2 && !inside(pts[0], pts[1])) {
    const first = pieces.shift()!
    const last = pieces.pop()!
    pieces.push([...last, ...first.slice(3)])
  }
  const minLength = Math.max(1, stroke.width / 2)
  return pieces.filter((p) => p.length >= 6 && polylineLength(p) >= minLength)
}
