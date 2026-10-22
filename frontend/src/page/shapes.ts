import { round } from './doc'
import type { Point } from './geometry'

/**
 * 도형 도구: 도형을 펜 획의 점([x, y, 필압, ...])으로 만든다. 펜 종류·색·굵기를 그대로 쓰고,
 * 지우개·선택·레이어·되돌리기도 보통 획처럼 동작한다.
 */
export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'arrow' | 'curve'

export const SHAPES: { id: ShapeKind; name: string; desc: string; icon: string }[] = [
  { id: 'rect', name: '사각형', desc: '끌어서 그려요 · Shift로 정사각형', icon: 'M4 5h14v12H4z' },
  { id: 'ellipse', name: '원', desc: '끌어서 그려요 · Shift로 정원', icon: 'M11 4.5c4.4 0 7.5 2.9 7.5 6.5s-3.1 6.5-7.5 6.5S3.5 14.6 3.5 11 6.6 4.5 11 4.5z' },
  { id: 'triangle', name: '삼각형', desc: '끌어서 그려요 · Shift로 정삼각형', icon: 'M11 4l8 14H3z' },
  { id: 'arrow', name: '화살표', desc: '끌어서 그려요 · Shift로 45도 단위', icon: 'M4 18L18 4M10 4h8v8' },
  { id: 'curve', name: '곡선', desc: '점을 찍어 이어요 · 두 번 눌러 끝, 첫 점을 누르면 닫혀요', icon: 'M3 16c3-10 6-10 8-5s5 5 8-5' },
]

export const DEFAULT_SHAPE: ShapeKind = 'rect'

/** 안을 채울 수 있는(닫힌) 도형. 곡선은 첫 점으로 닫았을 때만(그릴 때 따로 판단) */
export function closedShape(kind: ShapeKind): boolean {
  return kind === 'rect' || kind === 'ellipse' || kind === 'triangle'
}

/** 도형 채움 단계: 이름과 불투명도(0은 채우지 않음) */
export const SHAPE_FILL_NAMES = ['없음', '연하게', '보통', '진하게'] as const
export const SHAPE_FILLS = [0, 0.3, 0.6, 1] as const
export type ShapeFill = (typeof SHAPE_FILLS)[number]

export function isShapeFill(v: unknown): v is ShapeFill {
  return SHAPE_FILLS.some((f) => f === v)
}

export function isShape(v: unknown): v is ShapeKind {
  return SHAPES.some((s) => s.id === v)
}

/** 점 간격(장 좌표). 펜 종류(질감·만년필)가 손으로 그은 획처럼 보이게 촘촘히 둔다. */
export const SHAPE_STEP = 2
/** 도형 필압. 필압과 상관없이 굵기가 일정한 획(steady)으로 저장한다. */
export const SHAPE_PRESSURE = 0.5

/** 꺾은선을 같은 간격의 점으로 잇는다. 꼭짓점은 그대로 지난다. */
export function densify(path: Point[], pressure = SHAPE_PRESSURE): number[] {
  if (path.length === 0) return []
  const out: number[] = [round(path[0].x), round(path[0].y), pressure]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SHAPE_STEP))
    for (let k = 1; k <= steps; k++) {
      const t = k / steps
      out.push(round(a.x + (b.x - a.x) * t), round(a.y + (b.y - a.y) * t), pressure)
    }
  }
  return out
}

/** Shift: 가로·세로 중 긴 쪽에 맞춘다(끈 방향은 유지) */
function evenEnd(a: Point, b: Point, ratio = 1): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const side = Math.max(Math.abs(dx), Math.abs(dy) / ratio)
  return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side * ratio }
}

function arrowPath(a: Point, b: Point): Point[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len === 0) return [a]
  const head = Math.min(len * 0.4, Math.max(18, len * 0.15), 60)
  const back = Math.atan2(a.y - b.y, a.x - b.x)
  const wing = (turn: number) => ({ x: b.x + head * Math.cos(back + turn), y: b.y + head * Math.sin(back + turn) })
  // 한 획으로 잇는다: 몸통 → 끝 → 날개1 → 끝 → 날개2
  return [a, b, wing(0.5), b, wing(-0.5)]
}

/** 끌어서 그리는 도형(곡선 제외). a는 누른 곳, b는 지금 위치. even은 Shift(정사각형·정원·정삼각형·45도). */
export function shapePoints(kind: Exclude<ShapeKind, 'curve'>, a: Point, b: Point, even: boolean): number[] {
  if (kind === 'arrow') {
    let end = b
    if (even) {
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4)
      end = { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) }
    }
    return densify(arrowPath(a, end))
  }
  const e = even ? evenEnd(a, b, kind === 'triangle' ? Math.sqrt(3) / 2 : 1) : b
  const x0 = Math.min(a.x, e.x)
  const x1 = Math.max(a.x, e.x)
  const y0 = Math.min(a.y, e.y)
  const y1 = Math.max(a.y, e.y)
  if (kind === 'rect') {
    return densify([{ x: a.x, y: a.y }, { x: e.x, y: a.y }, { x: e.x, y: e.y }, { x: a.x, y: e.y }, { x: a.x, y: a.y }])
  }
  if (kind === 'triangle') {
    const apex = { x: (x0 + x1) / 2, y: y0 }
    return densify([apex, { x: x1, y: y1 }, { x: x0, y: y1 }, apex])
  }
  // 타원: 둘레를 촘촘히 돈다(맨 위에서 시작해 맨 위로 닫는다)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2
  const ry = (y1 - y0) / 2
  // 각도를 고르게 나누면 긴 반지름 쪽에서 점 사이가 가장 벌어진다. 거기서도 간격을 넘지 않게 센다.
  const n = Math.max(24, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / SHAPE_STEP))
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2
    const x = i === n ? cx : cx + rx * Math.cos(t)
    const y = i === n ? y0 : cy + ry * Math.sin(t)
    out.push(round(x), round(y), SHAPE_PRESSURE)
  }
  return out
}

/**
 * n점 곡선: 찍은 점을 모두 지나는 부드러운 곡선(Catmull-Rom). closed면 첫 점으로 돌아와 닫는다.
 */
export function curvePoints(controls: Point[], closed: boolean): number[] {
  if (controls.length < 2) return controls.length ? densify(controls) : []
  if (controls.length === 2 && !closed) return densify(controls)
  const n = controls.length
  const at = (i: number) => (closed ? controls[(i + n) % n] : controls[Math.min(n - 1, Math.max(0, i))])
  const segments = closed ? n : n - 1
  const out: number[] = [round(controls[0].x), round(controls[0].y), SHAPE_PRESSURE]
  for (let s = 0; s < segments; s++) {
    const p0 = at(s - 1)
    const p1 = at(s)
    const p2 = at(s + 1)
    const p3 = at(s + 2)
    // 곡선 길이를 대충 재서 간격을 정한다(직선 거리의 1.5배를 넘지 않는다고 본다)
    const steps = Math.max(2, Math.ceil((Math.hypot(p2.x - p1.x, p2.y - p1.y) * 1.5) / SHAPE_STEP))
    for (let k = 1; k <= steps; k++) {
      const t = k / steps
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      const x = k === steps ? p2.x : f(p0.x, p1.x, p2.x, p3.x)
      const y = k === steps ? p2.y : f(p0.y, p1.y, p2.y, p3.y)
      out.push(round(x), round(y), SHAPE_PRESSURE)
    }
  }
  return out
}
