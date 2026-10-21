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

describe('두 손가락 핀치', () => {
  it('두 손가락 사이 거리가 처음의 몇 배인지와 가운데 점을 돌려준다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    pan.down(2, 200, 100)
    // 오른손가락을 멀리: 거리 100 → 200. 문턱(8%)을 뺀 비율
    expect(pan.move(2, 300, 100)).toMatchObject({ cx: 200, cy: 100 })
    expect(pan.pinchRatio()).toBeCloseTo(2 / 1.08, 3)
    expect(pan.centerPoint()).toEqual({ x: 200, y: 100 })
    // 다시 가까이: 거리 50
    expect(pan.move(2, 150, 100)).toMatchObject({ cx: 125, cy: 100 })
    expect(pan.pinchRatio()).toBeCloseTo(0.5 / 0.92, 3)
  })

  it('한 손가락을 떼면 거리 비율은 더 바뀌지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 0, 0)
    pan.down(2, 100, 0)
    pan.up(2)
    expect(pan.move(1, 50, 0)).toMatchObject({ dx: 50 })
    expect(pan.pinchRatio()).toBeNull()
  })
})

describe('펜 전용 모드(solo): 한 손가락도 스크롤', () => {
  it('첫 손가락부터 스크롤이고, 두 번째 손가락이 닿으면 그때 거리를 기준으로 핀치한다', () => {
    const pan = new TouchPan()
    expect(pan.down(1, 100, 100, true)).toBe(true)
    expect(pan.move(1, 100, 130)).toMatchObject({ dx: 0, dy: 30 })
    expect(pan.pinchRatio()).toBeNull()
    expect(pan.down(2, 300, 130, true)).toBe(false)
    pan.move(2, 500, 130)
    expect(pan.pinchRatio()).toBeCloseTo(2 / 1.08, 3)
  })
})

describe('두 손가락 스크롤 중 거리 흔들림', () => {
  it('거리가 8% 안에서 흔들리는 동안은 핀치가 아니라 스크롤만이다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    pan.down(2, 200, 100)
    // 두 손가락이 함께 내려가며 거리가 100 → 104 → 97로 흔들린다
    pan.move(1, 100, 140)
    expect(pan.move(2, 204, 140)).toMatchObject({ dy: 20 })
    expect(pan.pinchRatio()).toBeNull()
    pan.move(1, 107, 180)
    pan.move(2, 204, 180)
    expect(pan.pinchRatio()).toBeNull()
  })

  it('문턱을 넘는 순간 비율이 1에서 이어져 배율이 튀지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    pan.down(2, 200, 100)
    pan.move(2, 207, 100)
    expect(pan.pinchRatio()).toBeNull()
    pan.move(2, 209, 100)
    expect(pan.pinchRatio()).toBeCloseTo(1.09 / 1.08, 3)
    // 한 손가락을 떼면 핀치가 풀린다
    pan.up(2)
    pan.move(1, 100, 150)
    expect(pan.pinchRatio()).toBeNull()
  })
})

describe('핀치 중 거리 흔들림(불감대)', () => {
  it('핀치로 들어간 뒤 2.5% 안에서 흔들리는 거리는 배율에 반영하지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    pan.down(2, 200, 100)
    pan.move(2, 320, 100) // 거리 220: 핀치 시작
    const engaged = pan.pinchRatio()
    expect(engaged).toBeCloseTo(2.2 / 1.08, 3)
    pan.move(2, 324, 100) // 224: +1.8%
    expect(pan.pinchRatio()).toBe(engaged)
    pan.move(2, 316, 100) // 216: -1.8%
    expect(pan.pinchRatio()).toBe(engaged)
    pan.move(2, 340, 100) // 240: 9% 넘게 변하면 반영
    expect(pan.pinchRatio()).toBeCloseTo(2.4 / 1.08, 3)
  })

  it('첫 손가락만 움직인 중간 상태는 판정하지 않으므로 사선 끌기에서 거리가 튀지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    pan.down(2, 212, 100)
    expect(pan.pinchRatio()).toBeNull()
    // 두 손가락이 함께 오른쪽 위로 6·-9씩 움직인다. 한 손가락씩 갱신해도 프레임 끝에만 판정한다.
    pan.move(1, 106, 91)
    pan.move(2, 218, 91)
    expect(pan.pinchRatio()).toBeNull()
  })
})
