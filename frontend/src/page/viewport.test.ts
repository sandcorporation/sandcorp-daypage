import { anchorAt, clampZoom, fitScaleIn, isPanButton, pinchZoom, scrollAfterZoom, wheelZoom } from './viewport'

test('배율은 35%~200% 사이로 맞춘다', () => {
  expect(clampZoom(0.1)).toBe(0.35)
  expect(clampZoom(5)).toBe(2)
  expect(clampZoom(Number.NaN)).toBe(1)
})

test('기준점 아래의 종이 자리가 배율을 바꾼 뒤에도 같도록 스크롤을 옮긴다', () => {
  // 50%로 그린 종이가 화면 (100, 80)에서 시작하고, 기준점은 화면 (300, 280) → 종이 좌표 (400, 400)
  const anchor = anchorAt({ clientX: 300, clientY: 280 }, { left: 100, top: 80 }, 0.5)
  expect(anchor).toEqual({ clientX: 300, clientY: 280, pageX: 400, pageY: 400 })
  // 100%로 바꿨더니(스크롤 그대로) 종이가 같은 자리에서 시작한다면, 종이 (400,400)은 화면 (500,480)에 있다.
  // 기준점 (300,280)에 오게 하려면 200·200만큼 더 스크롤한다.
  expect(scrollAfterZoom(anchor, { left: 100, top: 80 }, 1, { left: 50, top: 20 })).toEqual({ left: 250, top: 220 })
})

test('Ctrl+휠은 휠 양에 비례해 연속으로 바꾸고 범위 안에 둔다', () => {
  expect(wheelZoom(1, -100)).toBeCloseTo(1.221, 2)
  expect(wheelZoom(1, 100)).toBeCloseTo(0.819, 2)
  expect(wheelZoom(1.9, -1000)).toBe(2)
})

test('핀치는 두 손가락 거리 비율로 바꾼다', () => {
  expect(pinchZoom(0.5, 100, 200)).toBe(1)
  expect(pinchZoom(0.5, 100, 50)).toBe(0.35)
  expect(pinchZoom(0.5, 0, 50)).toBe(0.5)
})

test('화면에 맞추기는 폭 기준, 높이를 주면 둘 중 작은 쪽', () => {
  expect(fitScaleIn(800)).toBe(0.5)
  expect(fitScaleIn(800, 600)).toBe(0.25)
  expect(fitScaleIn(4000, 4000)).toBe(1)
})

test('가운데 버튼이나 Space를 누른 채 왼쪽 버튼이면 끌어 옮기기', () => {
  expect(isPanButton(1, false)).toBe(true)
  expect(isPanButton(0, true)).toBe(true)
  expect(isPanButton(0, false)).toBe(false)
  expect(isPanButton(2, true)).toBe(false)
})
