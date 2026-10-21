// @vitest-environment node
import { fingerScrollsOnly, isPenOnlyMode } from './penOnly'

test('자동: 펜을 본 뒤에만 손가락이 스크롤만 한다', () => {
  expect(fingerScrollsOnly('auto', false)).toBe(false)
  expect(fingerScrollsOnly('auto', true)).toBe(true)
})

test('켬·끔은 펜과 상관없다', () => {
  expect(fingerScrollsOnly('on', false)).toBe(true)
  expect(fingerScrollsOnly('off', true)).toBe(false)
})

test('모르는 값은 모드가 아니다', () => {
  expect(isPenOnlyMode('auto')).toBe(true)
  expect(isPenOnlyMode('maybe')).toBe(false)
})
