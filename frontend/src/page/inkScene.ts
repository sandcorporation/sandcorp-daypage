import { brushOf, type Stroke } from './doc'
import { strokeBounds, type Rect } from './hit'
import type { PixelRect } from './render'
import { softRadius } from './render'
import { apply, type Matrix } from './transform'

/**
 * 잉크·색 캔버스를 일부만 다시 그리기 위한 계산. 획이 지워지거나 옮겨지거나 미리보기(지우개·옮기기)가 바뀌면
 * 전체(1만 획) 대신 그 획들이 있던 자리와 갈 자리만 지우고, 그 자리에 걸치는 획만 같은 순서로 다시 그린다.
 * 같은 순서로 그리면 그 자리의 픽셀은 전체를 다시 그린 것과 같다(걸치지 않는 획은 그 자리에 칠하는 것이 없다).
 */

/**
 * 획이 칠할 수 있는 범위(장 좌표). 펜 외곽선은 필압이 세면 굵기의 반보다 넓다(perfect-freehand 반지름은
 * size × (0.5 + thinning/2)까지, 붓펜·크레용은 size가 굵기의 1.4·1.7배). 부드러운 채색은 번지는 만큼 더 넓다.
 */
export function paintBounds(stroke: Stroke): Rect {
  const b = strokeBounds(stroke)
  const brush = brushOf(stroke)
  const reach = stroke.tool !== 'pen' ? 0.5 : brush === 'brushpen' ? 1.2 : brush === 'crayon' ? 1 : 0.9
  // strokeBounds는 굵기의 반을 더했다. 그보다 넓게 닿는 만큼, 번짐과 안티앨리어싱 여유를 더한다.
  const pad = stroke.width * (reach - 0.5) + softRadius(stroke) * 3 + 2
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 }
}

/** 사각형을 변환한 뒤 감싸는 사각형 */
export function transformRect(r: Rect, m: Matrix): Rect {
  const pts = [apply(m, r.x, r.y), apply(m, r.x + r.width, r.y), apply(m, r.x, r.y + r.height), apply(m, r.x + r.width, r.y + r.height)]
  const xs = pts.map(([x]) => x)
  const ys = pts.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** 두 사각형을 감싸는 사각형(한쪽이 없으면 다른 쪽) */
export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * 장 좌표 사각형을 캔버스 픽셀 사각형(정수, 캔버스 안)으로. 픽셀 경계에 맞춰 넓히고 1px 더 둔다.
 * 캔버스 밖이면 null.
 */
export function toPixelRect(r: Rect, pixelScale: number, canvasWidth: number, canvasHeight: number): PixelRect | null {
  const x0 = Math.max(0, Math.floor(r.x * pixelScale) - 1)
  const y0 = Math.max(0, Math.floor(r.y * pixelScale) - 1)
  const x1 = Math.min(canvasWidth, Math.ceil((r.x + r.width) * pixelScale) + 1)
  const y1 = Math.min(canvasHeight, Math.ceil((r.y + r.height) * pixelScale) + 1)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** 픽셀 사각형을 장 좌표로(걸치는 획을 고를 때) */
export function fromPixelRect(r: PixelRect, pixelScale: number): Rect {
  return { x: r.x / pixelScale, y: r.y / pixelScale, width: r.width / pixelScale, height: r.height / pixelScale }
}

/**
 * 획마다 칠하는 범위를 기억한다. 지워진 획은 문서에서 읽을 수 없으니 지우기 전 범위를 여기서 찾는다.
 */
export class PaintedStrokes {
  private strokes = new Map<string, Stroke>()
  private bounds = new Map<string, Rect>()

  /** 처음부터 다시 채운다 */
  reset(strokes: Stroke[]): void {
    this.strokes.clear()
    this.bounds.clear()
    for (const s of strokes) this.set(s)
  }

  set(stroke: Stroke): void {
    this.strokes.set(stroke.id, stroke)
    this.bounds.set(stroke.id, paintBounds(stroke))
  }

  delete(id: string): void {
    this.strokes.delete(id)
    this.bounds.delete(id)
  }

  get(id: string): Stroke | undefined {
    return this.strokes.get(id)
  }

  all(): Stroke[] {
    return [...this.strokes.values()]
  }

  /** id들이 칠하는 범위를 감싸는 사각형. m이 있으면 그만큼 옮긴 자리. */
  boundsOf(ids: Iterable<string>, m?: Matrix): Rect | null {
    let out: Rect | null = null
    for (const id of ids) {
      const b = this.bounds.get(id)
      if (b) out = union(out, m ? transformRect(b, m) : b)
    }
    return out
  }

  /** rect에 걸치는 획 */
  within(rect: Rect): Stroke[] {
    const out: Stroke[] = []
    for (const [id, b] of this.bounds) if (overlaps(b, rect)) out.push(this.strokes.get(id)!)
    return out
  }

}
