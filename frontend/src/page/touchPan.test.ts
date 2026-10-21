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
    const far = pan.move(2, 300, 100)!
    expect(far).toMatchObject({ cx: 200, cy: 100 })
    expect(far.ratio).toBeCloseTo(2 / 1.08, 3)
    // 다시 가까이: 거리 50
    const near = pan.move(2, 150, 100)!
    expect(near).toMatchObject({ cx: 125, cy: 100 })
    expect(near.ratio).toBeCloseTo(0.5 / 0.92, 3)
  })

  it('한 손가락을 떼면 거리 비율은 더 바뀌지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 0, 0)
    pan.down(2, 100, 0)
    pan.up(2)
    expect(pan.move(1, 50, 0)).toMatchObject({ dx: 50, ratio: null })
  })
})

describe('펜 전용 모드(solo): 한 손가락도 스크롤', () => {
  it('첫 손가락부터 스크롤이고, 두 번째 손가락이 닿으면 그때 거리를 기준으로 핀치한다', () => {
    const pan = new TouchPan()
    expect(pan.down(1, 100, 100, true)).toBe(true)
    expect(pan.move(1, 100, 130)).toMatchObject({ dx: 0, dy: 30, ratio: null })
    expect(pan.down(2, 300, 130, true)).toBe(false)
    expect(pan.move(2, 500, 130)!.ratio).toBeCloseTo(2 / 1.08, 3)
  })
})

describe('두 손가락 스크롤 중 거리 흔들림', () => {
  it('거리가 8% 안에서 흔들리는 동안은 핀치가 아니라 스크롤만이다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    pan.down(2, 200, 100)
    // 두 손가락이 함께 내려가며 거리가 100 → 104 → 97로 흔들린다
    expect(pan.move(1, 100, 140)).toMatchObject({ dy: 20, ratio: null })
    expect(pan.move(2, 204, 140)).toMatchObject({ dy: 20, ratio: null })
    expect(pan.move(1, 107, 180)).toMatchObject({ ratio: null })
    expect(pan.move(2, 204, 180)).toMatchObject({ ratio: null })
  })

  it('문턱을 넘는 순간 비율이 1에서 이어져 배율이 튀지 않는다', () => {
    const pan = new TouchPan()
    pan.down(1, 100, 100)
    pan.down(2, 200, 100)
    expect(pan.move(2, 207, 100)!.ratio).toBeNull()
    expect(pan.move(2, 209, 100)!.ratio).toBeCloseTo(1.09 / 1.08, 3)
    // 한 손가락을 떼면 핀치가 풀린다
    pan.up(2)
    expect(pan.move(1, 100, 150)!.ratio).toBeNull()
  })
})
