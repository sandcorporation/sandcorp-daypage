// @vitest-environment node
import { stepZoom } from './ZoomControl'

test('맞춤 배율에서 한 단계씩 확대·축소한다', () => {
  expect(stepZoom(0.22, 1)).toBe(0.35)
  expect(stepZoom(0.35, 1)).toBe(0.5)
  expect(stepZoom(0.71, -1)).toBe(0.5)
  expect(stepZoom(0.35, -1)).toBe(0.35)
})

test('100%를 넘어 150%·200%까지 키울 수 있고, 200%가 끝이다', () => {
  expect(stepZoom(1, 1)).toBe(1.5)
  expect(stepZoom(1.5, 1)).toBe(2)
  expect(stepZoom(2, 1)).toBe(2)
  expect(stepZoom(2, -1)).toBe(1.5)
})
