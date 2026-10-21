/**
 * 터치 두 손가락 스크롤·핀치. 한 손가락은 그리기(도구 동작), 두 손가락이 닿으면 그때부터 스크롤로 본다.
 * 손가락이 모두 떨어질 때까지는 스크롤로 남아, 한 손가락을 먼저 떼도 선이 그어지지 않는다.
 *
 * 핀치 판정: 두 손가락으로 끌기만 해도 사이 거리는 자연스럽게 5~25%까지 흔들린다(실제 기록). 그래서 거리 변화의
 * 크기가 아니라 '최근 짧은 시간 동안 거리 변화가 가운데 점의 이동보다 우세한가'로 본다. 한 번 핀치로 들어가면
 * 손가락을 뗄 때까지 핀치이고, 들어간 순간의 거리를 1로 잡아 배율이 튀지 않는다. 그 뒤에도 PINCH_DEADBAND 안의
 * 흔들림은 배율에 반영하지 않는다.
 * 손가락 이벤트는 한 손가락씩 따로 오므로(첫 손가락만 움직인 중간 상태는 거리가 끌린 만큼 달라 보인다)
 * 거리 판정(pinchRatio)은 프레임마다 한 번, 두 손가락이 모두 갱신된 뒤에 부른다.
 */

/** 판정 창(ms): 이 시간 안의 거리 변화와 가운데 이동을 견준다 */
export const PINCH_WINDOW_MS = 200
/** 판정 창 안에서 거리가 이만큼(px)은 변해야 핀치 후보다 */
export const PINCH_MIN_DELTA = 20
/** 거리 변화가 가운데 이동의 이 배수 이상이어야 핀치(끌기가 우세하면 스크롤만) */
export const PINCH_DOMINANCE = 0.6
/** 핀치로 들어간 뒤 거리가 이만큼(비율) 안에서 흔들리면 배율을 바꾸지 않는다 */
export const PINCH_DEADBAND = 0.025

/**
 * 손가락 스크롤·핀치가 시작될 때 지면(.page-frame)에 띄우는 DOM 이벤트. 첫 손가락을 잡고 있던 자식(글 상자 손잡이 등)은
 * 이걸 듣고 끌기를 거둔다 — 안 그러면 두 손가락으로 화면을 움직이는 동안 그 상자가 따라 움직인다.
 */
export const PAN_START_EVENT = 'daypage:pan-start'

type Sample = { t: number; d: number; cx: number; cy: number }

export class TouchPan {
  private touches = new Map<number, { x: number; y: number }>()
  /** 지금 두 손가락 스크롤 중인지 */
  active = false
  /** 두 손가락이 모두 닿아 있는 동안의 최근 표본(거리·가운데 점) */
  private history: Sample[] = []
  /** 핀치로 들어갔는지, 들어간 순간의 거리, 마지막으로 배율에 반영한 비율 */
  private pinching = false
  private engageDistance = 0
  private applied = 1

  /**
   * 손가락이 닿았다. 이 손가락으로 스크롤이 시작되면 true(진행 중인 그리기는 취소해야 한다).
   * solo면 한 손가락만으로도 스크롤이다(펜 전용 모드: 손가락은 그리지 않는다).
   */
  down(id: number, x: number, y: number, solo = false, t = now()): boolean {
    this.touches.set(id, { x, y })
    if (this.touches.size === 2) {
      this.history = [this.sample(t)]
      this.pinching = false
    }
    if (this.active || (this.touches.size < 2 && !solo)) return false
    this.active = true
    return true
  }

  /** 손가락이 움직였다. 스크롤 중이면 손가락들의 가운데 점이 움직인 거리와 지금 가운데 점을 돌려준다. */
  move(id: number, x: number, y: number, t = now()): { dx: number; dy: number; cx: number; cy: number } | null {
    const prev = this.touches.get(id)
    if (!prev) return null
    const before = this.center()
    this.touches.set(id, { x, y })
    if (!this.active) return null
    const after = this.center()
    if (this.touches.size >= 2) {
      this.history.push(this.sample(t))
      while (this.history.length > 1 && t - this.history[1].t > PINCH_WINDOW_MS) this.history.shift()
    }
    return { dx: after.x - before.x, dy: after.y - before.y, cx: after.x, cy: after.y }
  }

  up(id: number): void {
    this.touches.delete(id)
    if (this.touches.size < 2) {
      this.pinching = false
      this.history = []
    }
    if (this.touches.size === 0) this.active = false
  }

  has(id: number): boolean {
    return this.touches.has(id)
  }

  /** 지금 손가락들의 가운데 점(핀치 기준점) */
  centerPoint(): { x: number; y: number } {
    return this.center()
  }

  /**
   * 핀치 비율(들어간 순간의 거리 대비). 두 손가락이 모두 닿아 있지 않거나 아직 끌기로 보이면 null.
   * 프레임마다 한 번 부른다.
   */
  pinchRatio(): number | null {
    if (this.touches.size < 2 || this.history.length === 0) return null
    const last = this.history[this.history.length - 1]
    if (!this.pinching) {
      const first = this.history[0]
      const delta = Math.abs(last.d - first.d)
      let travel = 0
      for (let i = 1; i < this.history.length; i++) {
        travel += Math.hypot(this.history[i].cx - this.history[i - 1].cx, this.history[i].cy - this.history[i - 1].cy)
      }
      if (delta < PINCH_MIN_DELTA || delta < PINCH_DOMINANCE * travel) return null
      this.pinching = true
      this.engageDistance = last.d
      this.applied = 1
      return 1
    }
    if (this.engageDistance <= 0) return null
    const r = last.d / this.engageDistance
    if (Math.abs(r / this.applied - 1) >= PINCH_DEADBAND) this.applied = r
    return this.applied
  }

  private sample(t: number): Sample {
    const c = this.center()
    return { t, d: this.distance(), cx: c.x, cy: c.y }
  }

  /** 처음 두 손가락 사이 거리 */
  private distance(): number {
    const [a, b] = [...this.touches.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
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

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
