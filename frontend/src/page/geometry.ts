/** 장은 고정 크기의 세로로 긴 종이다. 모든 좌표는 이 장 좌표계로 저장한다. */
export const PAGE_WIDTH = 1600
export const PAGE_HEIGHT = 2400
export const LINE_GAP = 32
export const MARGIN_X = 96

export type Point = { x: number; y: number }

/** 보이는 폭에 장 전체 폭이 들어가는 배율(최대 1). */
export function fitScale(viewportWidth: number): number {
  return Math.min(1, Math.max(0.1, viewportWidth / PAGE_WIDTH))
}

export function toPagePoint(clientX: number, clientY: number, rect: { left: number; top: number }, scale: number): Point {
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
}

/** 줄 간격에 맞춰 내린다. */
export function snapToLine(y: number): number {
  return Math.max(0, Math.round(y / LINE_GAP) * LINE_GAP)
}

export function clampToPage(p: Point): Point {
  return {
    x: Math.min(PAGE_WIDTH, Math.max(0, p.x)),
    y: Math.min(PAGE_HEIGHT, Math.max(0, p.y)),
  }
}
