import { placePopover } from './popoverPlacement'

const view = { width: 1280, height: 800 }
const size = { width: 300, height: 400 }
const rect = (left: number, top: number, w = 48, h = 48) => ({ left, top, right: left + w, bottom: top + h })

test('오른쪽(기본): 버튼 오른쪽, 위를 맞춘다', () => {
  expect(placePopover(rect(30, 200), size, view, 'right')).toEqual({ left: 90, top: 200 })
})

test('오른쪽에 자리가 없으면 버튼 아래에 오른쪽 끝을 맞춘다(머리글 오른쪽 버튼)', () => {
  expect(placePopover(rect(1100, 10), size, view, 'right')).toEqual({ left: 848, top: 66 })
})

test('왼쪽: 툴바를 오른쪽에 붙였을 때 버튼 왼쪽에 연다', () => {
  expect(placePopover(rect(1200, 200), size, view, 'left')).toEqual({ left: 888, top: 200 })
})

test('아래: 툴바를 위에 붙였을 때 버튼 아래, 화면 안으로 민다', () => {
  expect(placePopover(rect(100, 80), size, view, 'below')).toEqual({ left: 100, top: 136 })
  expect(placePopover(rect(1200, 80), size, view, 'below').left).toBe(1280 - 300 - 8)
})

test('위: 툴바를 아래에 붙였을 때 버튼 위에 연다', () => {
  expect(placePopover(rect(400, 700), size, view, 'above')).toEqual({ left: 400, top: 292 })
})

test('창이 화면보다 높아도 머리글 아래에서 시작한다', () => {
  expect(placePopover(rect(30, 700), { width: 300, height: 900 }, view, 'right').top).toBe(72)
  expect(placePopover(rect(400, 700), { width: 300, height: 900 }, view, 'above').top).toBe(72)
})

test('아래쪽 버튼(align bottom)은 창 아래를 버튼 아래에 맞춘다', () => {
  expect(placePopover(rect(30, 600), size, view, 'right', 'bottom')).toEqual({ left: 90, top: 248 })
})
