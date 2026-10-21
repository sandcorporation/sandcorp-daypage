// @vitest-environment node
import { clampCustomWidth, strokeWidth } from './tools'

test('기본 굵기 단계는 펜·형광펜마다 정한 값', () => {
  expect(strokeWidth('pen', 1)).toBe(6)
  expect(strokeWidth('highlighter', 2)).toBe(36)
})

test('직접 정한 굵기(px)가 있으면 단계 대신 그 값', () => {
  expect(strokeWidth('pen', 1, 18)).toBe(18)
  expect(strokeWidth('highlighter', 0, 18)).toBe(18)
  expect(strokeWidth('pen', 1, null)).toBe(6)
})

test('직접 정하는 굵기는 1~80 정수로 맞춘다', () => {
  expect(clampCustomWidth(0)).toBe(1)
  expect(clampCustomWidth(500)).toBe(80)
  expect(clampCustomWidth(12.6)).toBe(13)
  expect(clampCustomWidth(Number.NaN)).toBeNull()
})
