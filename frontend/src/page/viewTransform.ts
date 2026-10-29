/**
 * 보기 변환: 이 탭의 메모리에만 두는 90도 단위 회전과 좌우 거울. 문서·서버는 바꾸지 않는다.
 *
 * 합성 순서(하나로 정했다): 화면에 보이는 모양 = 거울(회전(장)). 즉 장을 먼저 시계 방향으로 돌리고,
 * 그 결과를 화면의 좌우로 뒤집는다. M은 늘 "화면의 좌우"를 뒤집고, 거울이 켜진 동안 R(시계 방향)은
 * 화면에서도 시계 방향으로 보이도록 내부 회전값을 반대로 돌린다(rotateView).
 *
 * 화면 좌표 ↔ 장 좌표 변환은 이 파일의 clientToPage / pageDeltaOf / pageToDisplay 한 곳만 거친다.
 * 거울(반전)은 `mirror` 필드와 viewMatrix의 마지막 단계에만 있어서, 나중에 "색 반전"으로 바뀌면 그 부분만 떼어 낸다.
 */
import { PAGE_HEIGHT, PAGE_WIDTH, type Point } from './geometry'
import { andThen, apply, type Matrix } from './transform'

export type Rotation = 0 | 90 | 180 | 270

export type ViewTransform = { rotation: Rotation; mirror: boolean }

export const VIEW_IDENTITY: ViewTransform = { rotation: 0, mirror: false }

export function isIdentityView(v: ViewTransform): boolean {
  return v.rotation === 0 && !v.mirror
}

export function sameView(a: ViewTransform, b: ViewTransform): boolean {
  return a.rotation === b.rotation && a.mirror === b.mirror
}

/** 화면에서 시계 방향(1)·반시계 방향(-1)으로 90도 돌린다. */
export function rotateView(v: ViewTransform, dir: 1 | -1): ViewTransform {
  const step = v.mirror ? -dir : dir
  return { ...v, rotation: ((((v.rotation + step * 90) % 360) + 360) % 360) as Rotation }
}

export function mirrorView(v: ViewTransform): ViewTransform {
  return { ...v, mirror: !v.mirror }
}

/** 90°/270°에서는 보이는 가로·세로가 바뀐다. */
export function swapsAxes(v: ViewTransform): boolean {
  return v.rotation === 90 || v.rotation === 270
}

/** 장(가로 w × 세로 h, 아무 단위)이 보기 변환을 거친 뒤 차지하는 상자 */
export function viewBox(v: ViewTransform, w: number, h: number): { width: number; height: number } {
  return swapsAxes(v) ? { width: h, height: w } : { width: w, height: h }
}

/** 보이는 상자의 크기를 장 기준 w×h로 바꿀 때 쓰는 보이는 장 크기(기본은 장 전체) */
export function pageViewBox(v: ViewTransform): { width: number; height: number } {
  return viewBox(v, PAGE_WIDTH, PAGE_HEIGHT)
}

function rotationMatrix(rotation: Rotation, w: number, h: number): Matrix {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, h, 0]
    case 180:
      return [-1, 0, 0, -1, w, h]
    case 270:
      return [0, -1, 1, 0, 0, w]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

/** 장 상자(w×h 픽셀)의 한 점을 보이는 상자의 점으로 옮기는 행렬. CSS `matrix(a,b,c,d,e,f)`와 같은 꼴(원점 0 0). */
export function viewMatrix(v: ViewTransform, w: number, h: number): Matrix {
  const rotated = rotationMatrix(v.rotation, w, h)
  if (!v.mirror) return rotated
  const box = viewBox(v, w, h)
  return andThen(rotated, [-1, 0, 0, 1, box.width, 0])
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

/** CSS transform 문자열 */
export function viewCss(v: ViewTransform, w: number, h: number): string {
  return `matrix(${viewMatrix(v, w, h).join(',')})`
}

/** 보이는 상자 안의 위치(상자 왼쪽 위 기준 화면 픽셀) → 장 좌표 */
export function displayToPage(v: ViewTransform, x: number, y: number, scale: number): Point {
  const inv = invertMatrix(viewMatrix(v, PAGE_WIDTH * scale, PAGE_HEIGHT * scale))
  const [px, py] = apply(inv, x, y)
  return { x: px / scale, y: py / scale }
}

/** 장 좌표 → 보이는 상자 안의 위치(화면 픽셀) */
export function pageToDisplay(v: ViewTransform, p: Point, scale: number): Point {
  const [x, y] = apply(viewMatrix(v, PAGE_WIDTH * scale, PAGE_HEIGHT * scale), p.x * scale, p.y * scale)
  return { x, y }
}

/** 화면 좌표(clientX/Y)와 보이는 상자의 화면 위치(rect) → 장 좌표(범위 안으로 자르지 않는다) */
export function clientToPage(v: ViewTransform, clientX: number, clientY: number, rect: { left: number; top: number }, scale: number): Point {
  return displayToPage(v, clientX - rect.left, clientY - rect.top, scale)
}

/** 화면에서의 이동량 → 장 좌표에서의 이동량 */
export function displayDeltaToPage(v: ViewTransform, dx: number, dy: number, scale: number): { dx: number; dy: number } {
  const inv = invertMatrix(viewMatrix(v, PAGE_WIDTH * scale, PAGE_HEIGHT * scale))
  return { dx: (inv[0] * dx + inv[2] * dy) / scale, dy: (inv[1] * dx + inv[3] * dy) / scale }
}

/** geometry.pageDelta의 보기 변환판: 끌기 시작 뒤의 이동량(장 좌표). 누른 채 스크롤해 상자가 움직여도 포인터를 따라간다. */
export function pageDeltaOf(
  v: ViewTransform,
  startClient: { x: number; y: number },
  startRect: { left: number; top: number },
  client: { x: number; y: number },
  rect: { left: number; top: number },
  scale: number,
): { dx: number; dy: number } {
  return displayDeltaToPage(v, client.x - rect.left - (startClient.x - startRect.left), client.y - rect.top - (startClient.y - startRect.top), scale)
}
