import { stepZoom } from './ZoomControl'

test('맞춤 배율에서 한 단계씩 확대·축소한다', () => {
  expect(stepZoom(0.22, 1)).toBe(0.35)
  expect(stepZoom(0.35, 1)).toBe(0.5)
  expect(stepZoom(1, 1)).toBe(1)
  expect(stepZoom(0.71, -1)).toBe(0.5)
  expect(stepZoom(0.35, -1)).toBe(0.35)
})
