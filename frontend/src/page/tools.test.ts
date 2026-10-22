// @vitest-environment node
import { clampCustomWidth, clampOpacity, isKnownInk, PAINT_PALETTE, PAINT_WIDTH_MAX, pushRecentInk, strokeWidth } from './tools'

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

test('채색 붓 굵기 단계는 펜보다 넓고, 직접 정하기는 200까지', () => {
  expect(strokeWidth('paint', 0)).toBe(24)
  expect(strokeWidth('paint', 2)).toBe(96)
  expect(strokeWidth('paint', 1, 150)).toBe(150)
  expect(clampCustomWidth(500, PAINT_WIDTH_MAX)).toBe(200)
})

test('불투명도는 0.1~1, 소수 둘째 자리', () => {
  expect(clampOpacity(0)).toBe(0.1)
  expect(clampOpacity(1.5)).toBe(1)
  expect(clampOpacity(0.456)).toBe(0.46)
  expect(clampOpacity(Number.NaN)).toBeNull()
})

test('채색 팔레트는 #rrggbb 12색이고, 잉크로 쓸 수 있는 색 판정에 들어간다', () => {
  expect(PAINT_PALETTE).toHaveLength(12)
  for (const c of PAINT_PALETTE) expect(c.color).toMatch(/^#[0-9A-F]{6}$/)
  expect(isKnownInk('#f6b8c8', [])).toBe(true)
  expect(isKnownInk('#2A47B0', [])).toBe(true)
  expect(isKnownInk('#123456', ['#123456'])).toBe(true)
  expect(isKnownInk('#123456', [])).toBe(false)
})

test('최근 색은 맨 앞에 넣고 중복을 빼며 6개까지', () => {
  expect(pushRecentInk([], '#AAAAAA')).toEqual(['#aaaaaa'])
  expect(pushRecentInk(['#aaaaaa', '#bbbbbb'], '#BBBBBB')).toEqual(['#bbbbbb', '#aaaaaa'])
  const six = ['#000001', '#000002', '#000003', '#000004', '#000005', '#000006']
  expect(pushRecentInk(six, '#000007')).toEqual(['#000007', ...six.slice(0, 5)])
})
