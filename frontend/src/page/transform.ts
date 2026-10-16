import { PAGE_HEIGHT, PAGE_WIDTH, type Point } from './geometry'
import type { Rect } from './hit'

/**
 * 고른 획 묶음(스티커 레이어 포함)을 옮기기·키우기·줄이기·돌리기 위한 기하.
 * 변환은 2D 아핀 행렬 [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f
 * 손을 떼면 획 좌표·굵기에 그대로 반영한다(doc.ts transformStrokes).
 */
export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function translate(dx: number, dy: number): Matrix {
  return [1, 0, 0, 1, dx, dy]
}

/** (cx, cy)를 두고 s배 */
export function scaleAbout(cx: number, cy: number, s: number): Matrix {
  return [s, 0, 0, s, cx - s * cx, cy - s * cy]
}

/** (cx, cy)를 두고 angle(라디안, 시계 방향) 회전 */
export function rotateAbout(cx: number, cy: number, angle: number): Matrix {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]
}

/** m을 먼저, 그다음 n을 적용하는 행렬. (then이라는 이름은 쓰지 않는다: 모듈이 Promise로 오인돼 import가 멈춘다) */
export function andThen(m: Matrix, n: Matrix): Matrix {
  return [
    n[0] * m[0] + n[2] * m[1],
    n[1] * m[0] + n[3] * m[1],
    n[0] * m[2] + n[2] * m[3],
    n[1] * m[2] + n[3] * m[3],
    n[0] * m[4] + n[2] * m[5] + n[4],
    n[1] * m[4] + n[3] * m[5] + n[5],
  ]
}

/** 길이가 몇 배가 되는지(획 굵기에 곱한다) */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

/** [x, y, 필압, ...] 점들을 변환한다(필압은 그대로) */
export function transformPoints(points: number[], m: Matrix): number[] {
  const out = points.slice()
  for (let i = 0; i + 1 < points.length; i += 3) {
    const [x, y] = apply(m, points[i], points[i + 1])
    out[i] = Math.round(x * 10) / 10
    out[i + 1] = Math.round(y * 10) / 10
  }
  return out
}

/** 상자 네 모서리(왼위·오위·오아래·왼아래)를 변환한 점들 */
export function transformedCorners(r: Rect, m: Matrix): [number, number][] {
  return [
    apply(m, r.x, r.y),
    apply(m, r.x + r.width, r.y),
    apply(m, r.x + r.width, r.y + r.height),
    apply(m, r.x, r.y + r.height),
  ]
}

export type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'rotate'

/** 손잡이 자리. 회전 손잡이는 위쪽 가운데에서 offset만큼 위에 있다. */
export function handlePoints(r: Rect, rotateOffset: number): Record<Handle, Point> {
  return {
    nw: { x: r.x, y: r.y },
    ne: { x: r.x + r.width, y: r.y },
    se: { x: r.x + r.width, y: r.y + r.height },
    sw: { x: r.x, y: r.y + r.height },
    rotate: { x: r.x + r.width / 2, y: r.y - rotateOffset },
  }
}

/** p가 닿은 손잡이(반지름 radius 안). 없으면 null */
export function handleAt(r: Rect, p: Point, radius: number, rotateOffset: number): Handle | null {
  const pts = handlePoints(r, rotateOffset)
  for (const h of ['rotate', 'nw', 'ne', 'se', 'sw'] as Handle[]) {
    if (Math.hypot(p.x - pts[h].x, p.y - pts[h].y) <= radius) return h
  }
  return null
}

/** 모서리를 끄는 손잡이의 반대편 모서리(키울 때 제자리에 있는 점) */
export function anchorOf(r: Rect, h: Exclude<Handle, 'rotate'>): Point {
  const opposite = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' } as const
  return handlePoints(r, 0)[opposite[h]]
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 8

/** 모서리를 start에서 p로 끌었을 때 비율(가로세로 비율은 유지). 반대편을 넘어가도 뒤집지 않는다. */
export function scaleFactor(anchor: Point, start: Point, p: Point): number {
  const vx = start.x - anchor.x
  const vy = start.y - anchor.y
  const len2 = vx * vx + vy * vy
  if (len2 === 0) return 1
  // 대각선 방향으로 투영한 길이의 비
  const s = ((p.x - anchor.x) * vx + (p.y - anchor.y) * vy) / len2
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

const SNAP = (3 * Math.PI) / 180

/** 가운데를 두고 start에서 p로 돌린 각. 0·90·180·270도 근처(3도)에서는 딱 맞춘다. */
export function rotationAngle(center: Point, start: Point, p: Point): number {
  let a = Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x)
  a = Math.atan2(Math.sin(a), Math.cos(a)) // -π..π
  const quarter = Math.round(a / (Math.PI / 2)) * (Math.PI / 2)
  if (Math.abs(a - quarter) < SNAP) a = quarter
  return Object.is(a, -0) ? 0 : a
}

/** 묶음이 페이지 밖으로 나갔으면 안으로 밀어 넣는 이동량(페이지보다 크면 왼쪽·위에 맞춘다) */
export function keepInPage(r: Rect): { dx: number; dy: number } {
  const fit = (pos: number, size: number, max: number) => (pos < 0 || size > max ? -pos : pos + size > max ? max - pos - size : 0)
  return { dx: fit(r.x, r.width, PAGE_WIDTH), dy: fit(r.y, r.height, PAGE_HEIGHT) }
}

/** 점들의 경계 상자 */
export function boundsOfPoints(pts: [number, number][]): Rect {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
