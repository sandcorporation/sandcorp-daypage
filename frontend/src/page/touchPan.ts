/**
 * 터치 두 손가락 스크롤. 한 손가락은 그리기(도구 동작), 두 손가락이 닿으면 그때부터 스크롤로 본다.
 * 손가락이 모두 떨어질 때까지는 스크롤로 남아, 한 손가락을 먼저 떼도 선이 그어지지 않는다.
 */
export class TouchPan {
  private touches = new Map<number, { x: number; y: number }>()
  /** 지금 두 손가락 스크롤 중인지 */
  active = false

  /** 손가락이 닿았다. 이 손가락으로 스크롤이 시작되면 true(진행 중인 그리기는 취소해야 한다). */
  down(id: number, x: number, y: number): boolean {
    this.touches.set(id, { x, y })
    if (this.active || this.touches.size < 2) return false
    this.active = true
    return true
  }

  /** 손가락이 움직였다. 스크롤 중이면 손가락들의 가운데 점이 움직인 거리를 돌려준다. */
  move(id: number, x: number, y: number): { dx: number; dy: number } | null {
    const prev = this.touches.get(id)
    if (!prev) return null
    const before = this.center()
    this.touches.set(id, { x, y })
    if (!this.active) return null
    const after = this.center()
    return { dx: after.x - before.x, dy: after.y - before.y }
  }

  up(id: number): void {
    this.touches.delete(id)
    if (this.touches.size === 0) this.active = false
  }

  has(id: number): boolean {
    return this.touches.has(id)
  }

  private center() {
    let x = 0
    let y = 0
    for (const t of this.touches.values()) {
      x += t.x
      y += t.y
    }
    const n = this.touches.size || 1
    return { x: x / n, y: y / n }
  }
}

/** el을 감싼 요소 중 그 방향으로 스크롤할 수 있는 가장 가까운 것을 움직인다. 없으면 문서를 움직인다. */
export function scrollNearest(el: HTMLElement, dx: number, dy: number) {
  const target = (axis: 'x' | 'y'): Element => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      const overflow = axis === 'x' ? style.overflowX : style.overflowY
      const room = axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight
      if (room && (overflow === 'auto' || overflow === 'scroll')) return node
    }
    return document.scrollingElement ?? document.documentElement
  }
  if (dx) target('x').scrollLeft += dx
  if (dy) target('y').scrollTop += dy
}
