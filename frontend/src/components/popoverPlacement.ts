/** 도구 창을 버튼의 어느 쪽에 열지. 도구 막대를 붙인 가장자리의 반대쪽으로 연다. */
export type PopoverSide = 'right' | 'left' | 'below' | 'above'

type Rect = { left: number; top: number; right: number; bottom: number }
type Size = { width: number; height: number }

const MARGIN = 8
const GAP = 12
/** 위쪽은 노트 머리말(약 64px) 아래로 */
const TOP_MIN = 72

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

/**
 * 버튼(anchor) 옆에 창을 둘 자리. 화면 안에 들어오게 민다.
 * 옆(오른쪽·왼쪽)에 자리가 없으면 버튼 아래에 연다(머리글 끝의 버튼 등).
 * align은 옆으로 열 때 창의 위를 버튼 위에 맞출지(top), 아래를 버튼 아래에 맞출지(bottom).
 */
export function placePopover(a: Rect, size: Size, view: Size, side: PopoverSide, align: 'top' | 'bottom' = 'top') {
  const { width: w, height: h } = size
  const maxLeft = view.width - w - MARGIN
  const maxTop = view.height - h - MARGIN
  const below = () => ({ left: clamp(a.left, MARGIN, maxLeft), top: Math.max(MARGIN, Math.min(a.bottom + MARGIN, maxTop)) })

  if (side === 'right' || side === 'left') {
    const left = side === 'right' ? a.right + GAP : a.left - GAP - w
    if (left < MARGIN || left > maxLeft) {
      // 옆에 자리가 없으면 버튼 아래, 오른쪽 끝을 버튼에 맞춘다
      return { left: clamp(a.right - w, MARGIN, maxLeft), top: Math.max(MARGIN, Math.min(a.bottom + MARGIN, maxTop)) }
    }
    const wanted = align === 'bottom' ? a.bottom - h : a.top
    return { left, top: Math.max(TOP_MIN, Math.min(wanted, maxTop)) }
  }
  if (side === 'below') return below()
  return { left: clamp(a.left, MARGIN, maxLeft), top: Math.max(TOP_MIN, a.top - MARGIN - h) }
}
