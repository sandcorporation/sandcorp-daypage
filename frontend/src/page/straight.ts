import type { Point } from './geometry'
import { densify, SHAPE_STEP } from './shapes'

/** 직선 위 점 간격(장 좌표). 도형과 같다. */
export const STRAIGHT_STEP = SHAPE_STEP
/** 수평·수직에서 이만큼(도) 안쪽이면 수평·수직으로 맞춘다(밑줄 긋기) */
const SNAP_DEGREES = 5

/**
 * Shift+드래그 직선의 점([x, y, 필압, ...]). 시작점에서 끝점까지 같은 간격으로 잇고 필압은 시작 값 하나로 둔다.
 * 거의 수평·수직이면 그쪽으로 맞춘다.
 */
export function straightPoints(start: Point, end: Point, pressure: number): number[] {
  let { x, y } = end
  const angle = Math.abs((Math.atan2(y - start.y, x - start.x) * 180) / Math.PI) // 0~180
  if (angle < SNAP_DEGREES || angle > 180 - SNAP_DEGREES) y = start.y
  else if (Math.abs(angle - 90) < SNAP_DEGREES) x = start.x
  if (x === start.x && y === start.y) return densify([start], pressure)
  return densify([start, { x, y }], pressure)
}
