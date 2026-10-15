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

/** 가장 가까운 줄 경계로 맞춘다(끌어서 옮긴 상자의 위쪽 모서리용). */
export function snapToLine(y: number): number {
  return Math.max(0, Math.round(y / LINE_GAP) * LINE_GAP)
}

export function clampToPage(p: Point): Point {
  return {
    x: Math.min(PAGE_WIDTH, Math.max(0, p.x)),
    y: Math.min(PAGE_HEIGHT, Math.max(0, p.y)),
  }
}

/** 그 점이 들어 있는 칸의 위쪽 경계(누른 자리에 상자를 만들 때). 맨 아래 칸을 넘지 않는다. */
export function rowTop(y: number): number {
  const row = Math.floor(Math.max(0, y) / LINE_GAP)
  return Math.min(row * LINE_GAP, PAGE_HEIGHT - LINE_GAP)
}

type ClientRect = { left: number; top: number }

/**
 * 끄기 시작한 뒤의 이동량(장 좌표). 화면 이동량이 아니라 장 위의 위치 차이로 계산해서,
 * 누른 채 스크롤해 장이 움직여도 끄는 것이 포인터를 따라간다.
 */
export function pageDelta(
  startClient: { x: number; y: number },
  startRect: ClientRect,
  client: { x: number; y: number },
  rect: ClientRect,
  scale: number,
): { dx: number; dy: number } {
  return {
    dx: (client.x - rect.left - (startClient.x - startRect.left)) / scale,
    dy: (client.y - rect.top - (startClient.y - startRect.top)) / scale,
  }
}
