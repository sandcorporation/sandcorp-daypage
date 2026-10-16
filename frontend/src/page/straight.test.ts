import { describe, expect, test } from 'vitest'
import { STRAIGHT_STEP, straightPoints } from './straight'

/** [x, y, p, ...]를 점 목록으로 */
function pts(flat: number[]) {
  const out = []
  for (let i = 0; i < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1], p: flat[i + 2] })
  return out
}

describe('Shift 직선', () => {
  test('시작점에서 끝점까지 같은 간격의 점으로 잇고, 필압은 시작 값 하나로 둔다', () => {
    const line = pts(straightPoints({ x: 10, y: 10 }, { x: 110, y: 60 }, 0.7))
    expect(line[0]).toEqual({ x: 10, y: 10, p: 0.7 })
    expect(line.at(-1)).toEqual({ x: 110, y: 60, p: 0.7 })
    for (let i = 1; i < line.length; i++) {
      const gap = Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y)
      expect(gap).toBeLessThanOrEqual(STRAIGHT_STEP + 0.15) // 좌표는 0.1 단위로 반올림한다
    }
    // 모든 점이 한 직선 위에 있다(기울기 1/2)
    for (const q of line) expect(Math.abs((q.y - 10) - (q.x - 10) / 2)).toBeLessThan(0.1)
    expect(line.every((q) => q.p === 0.7)).toBe(true)
  })

  test('거의 수평이면 수평으로 맞춘다(밑줄)', () => {
    const line = pts(straightPoints({ x: 0, y: 100 }, { x: 200, y: 108 }, 0.5))
    expect(line.every((q) => q.y === 100)).toBe(true)
    expect(line.at(-1)!.x).toBe(200)
  })

  test('거의 수직이면 수직으로 맞춘다', () => {
    const line = pts(straightPoints({ x: 50, y: 0 }, { x: 56, y: 150 }, 0.5))
    expect(line.every((q) => q.x === 50)).toBe(true)
    expect(line.at(-1)!.y).toBe(150)
  })

  test('비스듬한 선은 그대로 둔다', () => {
    const line = pts(straightPoints({ x: 0, y: 0 }, { x: 100, y: 30 }, 0.5))
    expect(line.at(-1)).toEqual({ x: 100, y: 30, p: 0.5 })
  })

  test('제자리면 점 하나', () => {
    expect(straightPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.5)).toEqual([5, 5, 0.5])
  })
})
