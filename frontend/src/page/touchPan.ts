/**
 * 터치 두 손가락 스크롤·핀치. 한 손가락은 그리기(도구 동작), 두 손가락이 닿으면 그때부터 스크롤로 본다.
 * 손가락이 모두 떨어질 때까지는 스크롤로 남아, 한 손가락을 먼저 떼도 선이 그어지지 않는다.
 * 두 손가락이 모두 닿아 있는 동안은 사이 거리가 처음의 몇 배인지(ratio)도 알려 준다(핀치 확대).
 * 두 손가락으로 스크롤만 해도 사이 거리는 조금씩 흔들리므로, 거리가 PINCH_THRESHOLD 이상 변하기 전에는
 * 핀치로 보지 않는다(ratio null). 넘는 순간부터는 문턱만큼을 뺀 비율을 주어 배율이 튀지 않고 이어진다.
 * 손가락 이벤트는 한 손가락씩 따로 오므로(첫 손가락만 움직인 중간 상태는 거리가 끌린 만큼 달라 보인다)
 * 거리 판정(pinchRatio)은 프레임마다 한 번, 두 손가락이 모두 갱신된 뒤에 부른다.
 */
export const PINCH_THRESHOLD = 0.08
/** 핀치로 들어간 뒤에도 거리가 이만큼(비율) 안에서 흔들리면 배율을 바꾸지 않는다(사선으로 끌 때 커졌다 작아졌다 하지 않게) */
export const PINCH_DEADBAND = 0.025

export class TouchPan {
  private touches = new Map<number, { x: number; y: number }>()
  /** 지금 두 손가락 스크롤 중인지 */
  active = false
  /** 두 손가락이 닿은 순간의 거리(핀치 기준) */
  private startDistance = 0
  /** 거리가 문턱을 넘어 핀치로 들어갔는지 */
  private pinching = false
  /** 마지막으로 배율에 반영한 거리 비율(불감대 기준) */
  private applied = 1

  /**
   * 손가락이 닿았다. 이 손가락으로 스크롤이 시작되면 true(진행 중인 그리기는 취소해야 한다).
   * solo면 한 손가락만으로도 스크롤이다(펜 전용 모드: 손가락은 그리지 않는다).
   */
  down(id: number, x: number, y: number, solo = false): boolean {
    this.touches.set(id, { x, y })
    if (this.touches.size === 2) {
      this.startDistance = this.distance()
      this.pinching = false
    }
    if (this.active || (this.touches.size < 2 && !solo)) return false
    this.active = true
    return true
  }

  /** 손가락이 움직였다. 스크롤 중이면 손가락들의 가운데 점이 움직인 거리와 지금 가운데 점을 돌려준다. */
  move(id: number, x: number, y: number): { dx: number; dy: number; cx: number; cy: number } | null {
    const prev = this.touches.get(id)
    if (!prev) return null
    const before = this.center()
    this.touches.set(id, { x, y })
    if (!this.active) return null
    const after = this.center()
    return { dx: after.x - before.x, dy: after.y - before.y, cx: after.x, cy: after.y }
  }

  /** 지금 손가락들의 가운데 점(핀치 기준점) */
  centerPoint(): { x: number; y: number } {
    return this.center()
  }

  /**
   * 핀치 비율. 두 손가락이 모두 닿아 있지 않거나 문턱 안이면 null, 넘으면 문턱만큼 뺀 비율(넘는 순간 1에서 이어진다).
   * 핀치로 들어간 뒤에는 PINCH_DEADBAND 안의 흔들림을 무시한다. 프레임마다 한 번 부른다.
   */
  pinchRatio(): number | null {
    if (this.touches.size < 2 || this.startDistance <= 0) return null
    let r = this.distance() / this.startDistance
    if (!this.pinching) {
      if (Math.abs(r - 1) < PINCH_THRESHOLD) return null
      this.pinching = true
      this.applied = r
    } else if (Math.abs(r / this.applied - 1) < PINCH_DEADBAND) {
      r = this.applied
    } else {
      this.applied = r
    }
    return r >= 1 ? r / (1 + PINCH_THRESHOLD) : r / (1 - PINCH_THRESHOLD)
  }

  /** 처음 두 손가락 사이 거리 */
  private distance(): number {
    const [a, b] = [...this.touches.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  up(id: number): void {
    this.touches.delete(id)
    if (this.touches.size < 2) this.pinching = false
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
