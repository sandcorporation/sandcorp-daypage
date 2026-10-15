import { formatCountdown, formatPageDate, millisUntil } from './time'

test('KST 23:59:50이면 새 장까지 00:00:10이 남는다', () => {
  const now = new Date('2026-10-15T23:59:50+09:00').getTime()
  expect(formatCountdown(millisUntil('2026-10-16T00:00:00+09:00', now))).toBe('00:00:10')
})

test('카운트다운은 시·분·초를 두 자리로 쓴다', () => {
  const now = new Date('2026-10-15T16:01:48+09:00').getTime()
  expect(formatCountdown(millisUntil('2026-10-16T00:00:00+09:00', now))).toBe('07:58:12')
})

test('자정이 지나면 00:00:00에서 멈춘다', () => {
  const now = new Date('2026-10-16T00:00:03+09:00').getTime()
  expect(formatCountdown(millisUntil('2026-10-16T00:00:00+09:00', now))).toBe('00:00:00')
})

test('장 날짜는 시안 형식으로 쓴다', () => {
  expect(formatPageDate('2026-10-15')).toBe('2026. 10. 15 (목)')
  expect(formatPageDate('2026-10-11')).toBe('2026. 10. 11 (일)')
})
