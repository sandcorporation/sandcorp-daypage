/**
 * 확대·이동 계산(순수 함수). 종이는 자기 스크롤 상자(page-viewport) 안에서만 움직인다.
 * 배율을 바꿀 때는 기준점(화면 좌표) 아래의 종이 자리가 그대로이도록 스크롤을 보정한다.
 */
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'

export const ZOOM_MIN = 0.35
export const ZOOM_MAX = 2

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** 화면 좌표의 한 점. 배율을 바꿀 때 이 점 아래의 종이 자리를 지킨다. */
export type ClientPoint = { clientX: number; clientY: number }

/** 배율을 바꾸기 전에 적어 두는 것: 기준점과 그 아래 종이 좌표 */
export type ZoomAnchor = ClientPoint & { pageX: number; pageY: number }

export function anchorAt(point: ClientPoint, frameRect: { left: number; top: number }, scale: number): ZoomAnchor {
  return {
    ...point,
    pageX: (point.clientX - frameRect.left) / scale,
    pageY: (point.clientY - frameRect.top) / scale,
  }
}

/**
 * 배율이 바뀐 뒤, 기준점 아래에 원래 종이 좌표가 오게 하는 스크롤 위치.
 * frameRect는 바뀐 배율로 그려진 종이의 지금 화면 위치(스크롤 보정 전).
 */
export function scrollAfterZoom(
  anchor: ZoomAnchor,
  frameRect: { left: number; top: number },
  scale: number,
  scroll: { left: number; top: number },
): { left: number; top: number } {
  const nowX = frameRect.left + anchor.pageX * scale
  const nowY = frameRect.top + anchor.pageY * scale
  return { left: scroll.left + (nowX - anchor.clientX), top: scroll.top + (nowY - anchor.clientY) }
}

/** Ctrl+휠·트랙패드 핀치: 휠 양에 비례해 연속으로 바꾼다(한 칸 100 ≈ ×1.22). */
export function wheelZoom(scale: number, deltaY: number): number {
  return clampZoom(scale * Math.exp(-deltaY * 0.002))
}

/** 두 손가락 거리 비율로 바꾼 배율 */
export function pinchZoom(startScale: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return clampZoom(startScale)
  return clampZoom((startScale * distance) / startDistance)
}

/** 화면에 맞추기: 폭(그리고 높이를 주면 높이까지)에 들어오는(box: 보기 변환을 거친 장의 가로·세로, 기본은 장 그대로) 가장 큰 배율. 1을 넘지 않는다. */
export function fitScaleIn(width: number, height?: number, box = { width: PAGE_WIDTH, height: PAGE_HEIGHT }): number {
  const byWidth = width / box.width
  const byHeight = height === undefined ? Infinity : height / box.height
  return Math.min(1, Math.max(0.1, Math.min(byWidth, byHeight)))
}

/** 끌어 옮기기(Space+드래그, 가운데 버튼)로 볼지 */
export function isPanButton(button: number, spaceHeld: boolean): boolean {
  return button === 1 || (button === 0 && spaceHeld)
}
