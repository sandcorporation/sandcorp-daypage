import type { Stroke } from './doc'
import { PAGE_HEIGHT, PAGE_WIDTH, type Point } from './geometry'
import { orderStrokes } from './render'

export type Rect = { x: number; y: number; width: number; height: number }

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  return orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b))
}

function strokeSegments(stroke: Stroke): [Point, Point][] {
  const pts: Point[] = []
  for (let i = 0; i + 1 < stroke.points.length; i += 3) pts.push({ x: stroke.points[i], y: stroke.points[i + 1] })
  if (pts.length === 1) return [[pts[0], pts[0]]]
  const segs: [Point, Point][] = []
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]])
  return segs
}

/** 지우개 경로(점 배열, 이웃 점 사이는 선분)에 닿은 획의 id. */
export function strokesHitBy(strokes: Stroke[], path: Point[], radius: number): string[] {
  if (path.length === 0) return []
  const eraser: [Point, Point][] =
    path.length === 1 ? [[path[0], path[0]]] : path.slice(1).map((p, i) => [path[i], p] as [Point, Point])
  return strokes
    .filter((s) => {
      const reach = radius + s.width / 2
      return strokeSegments(s).some(([a, b]) => eraser.some(([c, d]) => segmentDistance(a, b, c, d) <= reach))
    })
    .map((s) => s.id)
}

/** 그 점에서 가장 위에 그려진 획. */
export function topStrokeAt(strokes: Stroke[], p: Point, tolerance: number): Stroke | null {
  const ordered = orderStrokes(strokes).reverse()
  return ordered.find((s) => strokeSegments(s).some(([a, b]) => distToSegment(p, a, b) <= tolerance + s.width / 2)) ?? null
}

export function strokeBounds(stroke: Stroke): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < stroke.points.length; i += 3) {
    minX = Math.min(minX, stroke.points[i])
    maxX = Math.max(maxX, stroke.points[i])
    minY = Math.min(minY, stroke.points[i + 1])
    maxY = Math.max(maxY, stroke.points[i + 1])
  }
  const pad = stroke.width / 2
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad }
}

/** 경로(점들)를 radius만큼 사방으로 넓힌 경계 상자. 색인에서 근처 획을 찾을 때 쓴다. */
export function pathBounds(path: Point[], radius: number): Rect {
  const xs = path.map((p) => p.x)
  const ys = path.map((p) => p.y)
  const x = Math.min(...xs) - radius
  const y = Math.min(...ys) - radius
  return { x, y, width: Math.max(...xs) + radius - x, height: Math.max(...ys) + radius - y }
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  return { x, y, width: right - x, height: bottom - y }
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function strokesInRect(strokes: Stroke[], rect: Rect): string[] {
  return strokes.filter((s) => rectsOverlap(strokeBounds(s), rect)).map((s) => s.id)
}

/** 묶음 경계가 장 밖으로 나가지 않게 이동량을 줄인다. */
export function clampMoveDelta(bounds: Rect, dx: number, dy: number): { dx: number; dy: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return {
    dx: clamp(dx, -bounds.x, PAGE_WIDTH - (bounds.x + bounds.width)),
    dy: clamp(dy, -bounds.y, PAGE_HEIGHT - (bounds.y + bounds.height)),
  }
}
