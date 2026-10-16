import { round } from './doc'
import type { Point } from './geometry'

/** 직선 위 점 간격(장 좌표). 펜 종류(질감·만년필)가 손으로 그은 획처럼 보이게 촘촘히 둔다. */
export const STRAIGHT_STEP = 2
/** 수평·수직에서 이만큼(도) 안쪽이면 수평·수직으로 맞춘다(밑줄 긋기) */
const SNAP_DEGREES = 5

/**
 * Shift+드래그 직선의 점([x, y, 필압, ...]). 시작점에서 끝점까지 같은 간격으로 잇고 필압은 시작 값 하나로 둔다.
 * 거의 수평·수직이면 그쪽으로 맞춘다.
 */
export function straightPoints(start: Point, end: Point, pressure: number): number[] {
  let { x, y } = end
  const dx = x - start.x
  const dy = y - start.y
  const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) // 0~180
  if (angle < SNAP_DEGREES || angle > 180 - SNAP_DEGREES) y = start.y
  else if (Math.abs(angle - 90) < SNAP_DEGREES) x = start.x

  const length = Math.hypot(x - start.x, y - start.y)
  const steps = Math.ceil(length / STRAIGHT_STEP)
  if (steps === 0) return [round(start.x), round(start.y), pressure]
  const out: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push(round(start.x + (x - start.x) * t), round(start.y + (y - start.y) * t), pressure)
  }
  return out
}
