// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TouchPan } from './touchPan'

describe('두 손가락 스크롤', () => {
  it('한 손가락은 스크롤이 아니다', () => {
    const pan = new TouchPan()
    expect(pan.down(1, 100, 100)).toBe(false)
    expect(pan.move(1, 100, 150)).toBeNull()
    expect(pan.active).toBe(false)
  })

  it('두 번째 손가락이 닿으면 스크롤이 시작되고, 가운데 점이 움직인 만큼 돌려준다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    expect(pan.down(2, 200, 100)).toBe(true)
    // 한 손가락만 40 내리면 가운데 점은 20 내려간다
    expect(pan.move(1, 100, 140)).toMatchObject({ dx: 0, dy: 20 })
    expect(pan.move(2, 200, 140)).toMatchObject({ dx: 0, dy: 20 })
  })

  it('한 손가락을 먼저 떼도 모든 손가락이 떨어질 때까지 스크롤로 남는다', () => {
    const pan = new TouchPan()
    pan.down(1, 0, 0)
    pan.down(2, 10, 0)
    pan.up(2)
    expect(pan.active).toBe(true)
    expect(pan.move(1, 0, 30)).toMatchObject({ dx: 0, dy: 30 })
    pan.up(1)
    expect(pan.active).toBe(false)
    expect(pan.down(3, 0, 0)).toBe(false)
  })

  it('세 번째 손가락은 스크롤을 다시 시작하지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 0, 0)
    pan.down(2, 10, 0)
    expect(pan.down(3, 20, 0)).toBe(false)
  })
})

describe('펜 전용 모드(solo): 한 손가락도 스크롤', () => {
  it('첫 손가락부터 스크롤이고, 두 번째 손가락이 닿으면 핀치도 된다', () => {
    const pan = new TouchPan()
    expect(pan.down(1, 100, 100, true, 0)).toBe(true)
    expect(pan.move(1, 100, 130, 10)).toMatchObject({ dx: 0, dy: 30 })
    expect(pan.pinchRatio()).toBeNull()
    expect(pan.down(2, 300, 130, true, 20)).toBe(false)
    pan.move(2, 400, 130, 60)
    expect(pan.pinchRatio()).toBe(1)
    pan.move(2, 500, 130, 100)
    expect(pan.pinchRatio()).toBeCloseTo(400 / 300, 3)
  })
})

describe('두 손가락 핀치', () => {
  it('거리가 벌어지며 가운데는 거의 안 움직이면 핀치: 들어간 순간이 1, 그 뒤 거리 비율', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100, false, 0)
    pan.down(2, 200, 100, false, 0)
    // 오른손가락을 멀리: 거리 100 → 130 (20px 넘게, 가운데는 15px 이동)
    pan.move(2, 230, 100, 50)
    expect(pan.pinchRatio()).toBe(1)
    expect(pan.centerPoint()).toEqual({ x: 165, y: 100 })
    // 더 멀리: 130 → 260
    pan.move(2, 360, 100, 100)
    expect(pan.pinchRatio()).toBeCloseTo(2, 3)
    // 다시 가까이: 65
    pan.move(2, 165, 100, 150)
    expect(pan.pinchRatio()).toBeCloseTo(0.5, 3)
  })

  it('한 손가락을 떼면 핀치가 풀리고 비율은 더 바뀌지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 0, 0, false, 0)
    pan.down(2, 100, 0, false, 0)
    pan.move(2, 140, 0, 50)
    expect(pan.pinchRatio()).toBe(1)
    pan.up(2)
    pan.move(1, 50, 0, 100)
    expect(pan.pinchRatio()).toBeNull()
  })

  it('핀치로 들어간 뒤 2.5% 안에서 흔들리는 거리는 배율에 반영하지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100, false, 0)
    pan.down(2, 200, 100, false, 0)
    pan.move(2, 240, 100, 50) // 거리 140: 핀치 시작
    expect(pan.pinchRatio()).toBe(1)
    pan.move(2, 242, 100, 70) // 142: +1.4%
    expect(pan.pinchRatio()).toBe(1)
    pan.move(2, 237, 100, 90) // 137: -2.1%
    expect(pan.pinchRatio()).toBe(1)
    pan.move(2, 260, 100, 110) // 160: +14%
    expect(pan.pinchRatio()).toBeCloseTo(160 / 140, 3)
  })
})

describe('두 손가락 끌기: 거리가 흔들려도 핀치가 아니다', () => {
  it('끌기가 우세하면 거리가 20px 넘게 변해도 스크롤만이다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100, false, 0)
    pan.down(2, 250, 100, false, 0)
    // 두 손가락이 함께 위로 600px 끌리는 동안 거리가 150 → 180 → 140으로 흔들린다
    let t = 0
    for (let i = 1; i <= 30; i++) {
      t += 16
      const wobble = i <= 15 ? i * 2 : 30 - (i - 15) * 4
      pan.move(1, 100, 100 - i * 20, t)
      pan.move(2, 250 + wobble, 100 - i * 20, t)
      expect(pan.pinchRatio()).toBeNull()
    }
  })

  it('첫 손가락만 움직인 중간 상태는 판정하지 않으므로 사선 끌기에서 거리가 튀지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100, false, 0)
    pan.down(2, 212, 100, false, 0)
    expect(pan.pinchRatio()).toBeNull()
    // 두 손가락이 함께 오른쪽 위로 6·-9씩 움직인다. 한 손가락씩 갱신해도 프레임 끝에만 판정한다.
    for (let i = 1; i <= 20; i++) {
      pan.move(1, 100 + i * 6, 100 - i * 9, i * 16)
      pan.move(2, 212 + i * 6, 100 - i * 9, i * 16)
      expect(pan.pinchRatio()).toBeNull()
    }
  })

  it('끌다가 멈춘 채 벌리면 그때부터 핀치다(오래 끈 뒤에도)', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100, false, 0)
    pan.down(2, 250, 100, false, 0)
    let t = 0
    for (let i = 1; i <= 60; i++) {
      t += 16
      pan.move(1, 100, 100 - i * 20, t)
      pan.move(2, 250, 100 - i * 20, t)
      pan.pinchRatio()
    }
    // 멈춘 자리에서 한 손가락을 꾸준히 벌린다. 판정 창(200ms)이 끌던 구간을 벗어나면 핀치로 들어간다.
    let engaged: number | null = null
    for (let i = 1; i <= 16 && engaged === null; i++) {
      t += 16
      pan.move(2, 250 + i * 10, 100 - 60 * 20, t)
      engaged = pan.pinchRatio()
    }
    expect(engaged).toBe(1)
    // 들어간 뒤로는 그 순간의 거리가 기준이다
    pan.move(2, 250 + 16 * 10 + 82, 100 - 60 * 20, t + 16)
    expect(pan.pinchRatio()).toBeGreaterThan(1.1)
  })
})

describe('여러 손가락 탭', () => {
  it('두 손가락으로 짧게 톡 치면 마지막 손가락이 떨어질 때 2를 돌려준다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100, false, 0)
    pan.down(2, 200, 100, false, 20)
    expect(pan.up(1, 120)).toBeNull()
    expect(pan.up(2, 150)).toBe(2)
  })

  it('세 손가락이면 3', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100, false, 0)
    pan.down(2, 150, 100, false, 10)
    pan.down(3, 200, 100, false, 20)
    pan.up(1, 100)
    pan.up(2, 110)
    expect(pan.up(3, 120)).toBe(3)
  })

  it('한 손가락 탭, 움직인 손가락, 오래 누른 것, 취소된 것은 탭이 아니다', () => {
    const one = new TouchPan()
    one.down(1, 0, 0, false, 0)
    expect(one.up(1, 50)).toBeNull()

    const moved = new TouchPan()
    moved.down(1, 0, 0, false, 0)
    moved.down(2, 100, 0, false, 10)
    moved.move(2, 100, 30, 50)
    moved.up(1, 100)
    expect(moved.up(2, 110)).toBeNull()

    const slow = new TouchPan()
    slow.down(1, 0, 0, false, 0)
    slow.down(2, 100, 0, false, 10)
    slow.up(1, 400)
    expect(slow.up(2, 410)).toBeNull()

    const cancelled = new TouchPan()
    cancelled.down(1, 0, 0, false, 0)
    cancelled.down(2, 100, 0, false, 10)
    cancelled.up(1, 50, true)
    expect(cancelled.up(2, 60)).toBeNull()
  })

  it('조금 흔들린 것(TAP_SLOP 안)은 탭이고, 탭이 끝나면 다음 묶음은 새로 센다', () => {
    const pan = new TouchPan()
    pan.down(1, 0, 0, false, 0)
    pan.down(2, 100, 0, false, 10)
    pan.move(1, 5, 5, 50)
    pan.up(1, 100)
    expect(pan.up(2, 110)).toBe(2)
    pan.down(1, 0, 0, false, 1000)
    expect(pan.up(1, 1050)).toBeNull()
  })
})
