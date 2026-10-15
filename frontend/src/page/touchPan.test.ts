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
    expect(pan.move(1, 100, 140)).toEqual({ dx: 0, dy: 20 })
    expect(pan.move(2, 200, 140)).toEqual({ dx: 0, dy: 20 })
  })

  it('한 손가락을 먼저 떼도 모든 손가락이 떨어질 때까지 스크롤로 남는다', () => {
    const pan = new TouchPan()
    pan.down(1, 0, 0)
    pan.down(2, 10, 0)
    pan.up(2)
    expect(pan.active).toBe(true)
    expect(pan.move(1, 0, 30)).toEqual({ dx: 0, dy: 30 })
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
