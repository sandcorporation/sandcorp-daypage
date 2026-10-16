import { addStroke, createPageDoc, readStrokes, type Stroke } from './doc'
import { BRUSHES, fountainPressure } from './tools'

function stroke(partial: Partial<Stroke>): Stroke {
  return { id: 's', tool: 'pen', color: '#000000', width: 6, points: [0, 0, 0.5], author: 'me', createdAt: 0, ...partial }
}

test('만년필을 고를 수 있다', () => {
  expect(BRUSHES.map((b) => b.id)).toContain('fountain')
})

test('빠르게 그으면 가늘게(필압 작게), 천천히 그으면 굵게', () => {
  const slow = fountainPressure(0.6, 2, 20) // 0.1px/ms
  const fast = fountainPressure(0.6, 60, 20) // 3px/ms
  expect(fast).toBeLessThan(slow)
})

test('필압 값은 0.15~1 사이이고 소수 둘째 자리까지', () => {
  for (const [d, ms] of [
    [0, 16],
    [500, 1],
    [1, 1000],
    [10, 0],
  ]) {
    const p = fountainPressure(0.5, d, ms)
    expect(p).toBeGreaterThanOrEqual(0.15)
    expect(p).toBeLessThanOrEqual(1)
    expect(Math.round(p * 100) / 100).toBe(p)
  }
})

test('갑자기 튀지 않게 앞 값에서 조금씩 따라간다', () => {
  const next = fountainPressure(1, 200, 20)
  expect(next).toBeGreaterThan(fountainPressure(0.15, 200, 20))
  expect(next).toBeLessThan(1)
})

test('필압을 끄고 그린 획은 굵기가 일정하다고 저장되고 다른 화면에서도 그렇게 읽힌다', () => {
  const doc = createPageDoc('2026-10-16')
  addStroke(doc, stroke({ id: 'a', steady: true }))
  addStroke(doc, stroke({ id: 'b' }))
  const byId = Object.fromEntries(readStrokes(doc).map((s) => [s.id, s]))
  expect(byId.a.steady).toBe(true)
  expect(byId.b.steady).toBeUndefined()
})
