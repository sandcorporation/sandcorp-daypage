// @vitest-environment node
import { brushOf } from './doc'
import { GRAIN_SIZE, grainAlpha, grainSeed } from './texture'
import { BRUSHES } from './tools'

const holes = (a: Uint8ClampedArray) => a.filter((v) => v === 0).length

test('같은 획(같은 시드)의 질감은 몇 번을 다시 만들어도 같다', () => {
  expect(grainAlpha('pencil', 3)).toEqual(grainAlpha('pencil', 3))
  expect(grainAlpha('crayon', 5)).toEqual(grainAlpha('crayon', 5))
})

test('시드가 다르면 무늬가 다르다', () => {
  expect(grainAlpha('pencil', 1)).not.toEqual(grainAlpha('pencil', 2))
})

test('시드는 펜 종류·색 문자열로 정해지고 언제나 같다(겹쳐 칠해도 결이 이어진다)', () => {
  expect(grainSeed('crayon#1F2128')).toBe(grainSeed('crayon#1F2128'))
  expect(grainSeed('abc123')).toBe(grainSeed('abc123'))
  expect(grainSeed('abc123')).toBeGreaterThanOrEqual(0)
})

test('크레용은 연필보다 거칠다(빈 곳이 많다)', () => {
  const pencil = grainAlpha('pencil', 1)
  const crayon = grainAlpha('crayon', 1)
  expect(pencil.length).toBe(GRAIN_SIZE * GRAIN_SIZE)
  expect(holes(crayon)).toBeGreaterThan(holes(pencil))
  // 그래도 대부분은 칠해져 있다
  expect(holes(crayon)).toBeLessThan(crayon.length / 2)
})

test('연필·크레용을 고를 수 있고 획에서 그대로 읽힌다', () => {
  const ids = BRUSHES.map((b) => b.id)
  expect(ids).toEqual(expect.arrayContaining(['pencil', 'crayon']))
  const s = { id: 'a', tool: 'pen' as const, color: '#000000', width: 6, points: [], author: 'me', createdAt: 0 }
  expect(brushOf({ ...s, brush: 'pencil' })).toBe('pencil')
  expect(brushOf({ ...s, brush: 'crayon' })).toBe('crayon')
})
