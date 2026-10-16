import { hexToHsv, hsvToHex, normalizeHex } from './color'

test('색 코드를 #rrggbb 소문자로 맞추고, 틀린 형식은 null', () => {
  expect(normalizeHex('#16794F')).toBe('#16794f')
  expect(normalizeHex('16794f')).toBe('#16794f')
  expect(normalizeHex(' #ABCDEF ')).toBe('#abcdef')
  expect(normalizeHex('#fff')).toBeNull()
  expect(normalizeHex('red')).toBeNull()
})

test('HSV와 색 코드를 오가도 같은 색이다', () => {
  for (const hex of ['#16794f', '#2a47b0', '#ffffff', '#000000', '#e0603a']) {
    expect(hsvToHex(hexToHsv(hex))).toBe(hex)
  }
})

test('색상 0·채도 1·명도 1은 빨강', () => {
  expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000')
  expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
})
