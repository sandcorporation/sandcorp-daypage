// @vitest-environment node
import { formatCountdown, formatPageDate, millisUntil, formatHourRange, formatPageKey, parsePageKey, seqSuffix } from './time'

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

describe('페이지 키와 기간 표시', () => {
  test('같은 날짜의 둘째 장부터 (2)가 붙는다', () => {
    expect(seqSuffix(1)).toBe('')
    expect(seqSuffix(2)).toBe(' (2)')
    expect(formatPageKey('2026-10-21')).toBe('10월 21일 (수)')
    expect(formatPageKey('2026-10-21-2')).toBe('10월 21일 (수) (2)')
    expect(parsePageKey('2026-10-21-3')).toEqual({ date: '2026-10-21', seq: 3 })
  })

  test('하루를 다 채우지 않은 페이지만 시간 범위를 보인다', () => {
    expect(formatHourRange('2026-10-21T00:00:00+09:00', '2026-10-22T00:00:00+09:00')).toBeNull()
    expect(formatHourRange('2026-10-21T00:00:00+09:00', '2026-10-21T11:00:00+09:00')).toBe('00:00–11:00')
    expect(formatHourRange('2026-10-21T04:00:00+09:00', '2026-10-22T11:00:00+09:00')).toBe('04:00–11:00')
  })
})
