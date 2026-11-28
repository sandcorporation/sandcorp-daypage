import { describe, expect, test } from 'vitest'
import { addLost, LOST_JOINS_ROLL_FOR_MS, lostText, rolledText } from './lostEdits'

const BASE = '새 페이지가 열렸어요'

describe('장이 바뀌는 순간 버린 편집 알림(#268)', () => {
  test('막 받은 버린 수는 새 페이지 알림에 붙는다', () => {
    expect(rolledText(BASE, { count: 3, at: 1000 }, 1500)).toBe(`${BASE}. ${lostText(3)}`)
  })

  test('버린 것이 없거나 오래전 것이면 새 페이지 알림 그대로다', () => {
    expect(rolledText(BASE, null, 1000)).toBe(BASE)
    expect(rolledText(BASE, { count: 3, at: 0 }, LOST_JOINS_ROLL_FOR_MS)).toBe(BASE)
  })

  test('잇달아 온 버린 수는 더하고, 오래된 것은 새로 센다', () => {
    const first = addLost(null, 1, 0)
    expect(addLost(first, 2, 100)).toEqual({ count: 3, at: 100 })
    expect(addLost(first, 2, LOST_JOINS_ROLL_FOR_MS)).toEqual({ count: 2, at: LOST_JOINS_ROLL_FOR_MS })
  })
})
