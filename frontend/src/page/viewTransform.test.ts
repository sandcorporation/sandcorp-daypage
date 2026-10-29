import { describe, expect, test } from 'vitest'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { DEFAULT_KEYMAP, SHORTCUT_ACTIONS, actionFor } from './shortcuts'
import {
  VIEW_IDENTITY,
  clientToPage,
  displayDeltaToPage,
  displayToPage,
  isIdentityView,
  mirrorView,
  pageDeltaOf,
  pageToDisplay,
  rotateView,
  viewBox,
  viewMatrix,
  type Rotation,
  type ViewTransform,
} from './viewTransform'
import { apply } from './transform'

const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const ALL: ViewTransform[] = ROTATIONS.flatMap((rotation) => [false, true].map((mirror) => ({ rotation, mirror })))

describe('보기 변환', () => {
  test('8가지 상태 모두 장 → 화면 → 장 왕복이 제자리로 돌아온다', () => {
    for (const v of ALL)
      for (const scale of [0.35, 0.5, 1.7])
        for (const p of [{ x: 0, y: 0 }, { x: PAGE_WIDTH, y: 0 }, { x: 123.5, y: 2001 }, { x: PAGE_WIDTH, y: PAGE_HEIGHT }]) {
          const d = pageToDisplay(v, p, scale)
          const back = displayToPage(v, d.x, d.y, scale)
          expect(back.x).toBeCloseTo(p.x, 6)
          expect(back.y).toBeCloseTo(p.y, 6)
        }
  })

  test('장의 네 모서리는 보이는 상자 안에 들어오고, 90/270도에서는 가로·세로가 바뀐다', () => {
    for (const v of ALL) {
      const box = viewBox(v, PAGE_WIDTH, PAGE_HEIGHT)
      expect(box.width).toBe(v.rotation % 180 ? PAGE_HEIGHT : PAGE_WIDTH)
      const m = viewMatrix(v, PAGE_WIDTH, PAGE_HEIGHT)
      for (const [x, y] of [[0, 0], [PAGE_WIDTH, 0], [0, PAGE_HEIGHT], [PAGE_WIDTH, PAGE_HEIGHT]]) {
        const [dx, dy] = apply(m, x, y)
        expect(dx).toBeGreaterThanOrEqual(-1e-9)
        expect(dx).toBeLessThanOrEqual(box.width + 1e-9)
        expect(dy).toBeGreaterThanOrEqual(-1e-9)
        expect(dy).toBeLessThanOrEqual(box.height + 1e-9)
      }
    }
  })

  test('시계 방향 90도: 장의 왼쪽 위 모서리는 화면 오른쪽 위로 간다', () => {
    const d = pageToDisplay({ rotation: 90, mirror: false }, { x: 0, y: 0 }, 1)
    expect(d).toEqual({ x: PAGE_HEIGHT, y: 0 })
    // 장의 오른쪽 위는 오른쪽 아래로
    expect(pageToDisplay({ rotation: 90, mirror: false }, { x: PAGE_WIDTH, y: 0 }, 1)).toEqual({ x: PAGE_HEIGHT, y: PAGE_WIDTH })
  })

  test('거울은 화면의 좌우를 뒤집는다(돌린 뒤에도)', () => {
    expect(pageToDisplay({ rotation: 0, mirror: true }, { x: 0, y: 10 }, 1)).toEqual({ x: PAGE_WIDTH, y: 10 })
    // 90도 + 거울: 장의 왼쪽 위는 (회전하면 오른쪽 위) 거울로 왼쪽 위
    const d = pageToDisplay({ rotation: 90, mirror: true }, { x: 0, y: 0 }, 1)
    expect(d.x).toBeCloseTo(0, 9)
    expect(d.y).toBeCloseTo(0, 9)
  })

  test('R 네 번이면 제자리, 거울이 켜져 있어도 R은 화면에서 시계 방향', () => {
    let v = VIEW_IDENTITY
    for (let i = 0; i < 4; i++) v = rotateView(v, 1)
    expect(isIdentityView(v)).toBe(true)
    expect(rotateView(VIEW_IDENTITY, -1).rotation).toBe(270)
    // 거울 상태에서 화면 위쪽(0,-1 방향)에 있던 것이 R 뒤에는 화면 오른쪽에 온다
    const mirrored = mirrorView(VIEW_IDENTITY)
    const before = pageToDisplay(mirrored, { x: PAGE_WIDTH / 2, y: 0 }, 1) // 위 가운데
    const after = pageToDisplay(rotateView(mirrored, 1), { x: PAGE_WIDTH / 2, y: 0 }, 1)
    expect(before.y).toBe(0)
    expect(after.x).toBe(PAGE_HEIGHT) // 위쪽 가장자리가 오른쪽 가장자리로: 시계 방향
    expect(isIdentityView(mirrorView(mirrorView(VIEW_IDENTITY)))).toBe(true)
  })

  test('화면 좌표(clientX/Y)와 이동량도 같은 역변환을 거친다', () => {
    const v: ViewTransform = { rotation: 270, mirror: true }
    const rect = { left: 40, top: 70 }
    const scale = 0.5
    const p = { x: 300, y: 900 }
    const d = pageToDisplay(v, p, scale)
    const q = clientToPage(v, rect.left + d.x, rect.top + d.y, rect, scale)
    expect(q.x).toBeCloseTo(p.x, 6)
    expect(q.y).toBeCloseTo(p.y, 6)
    // 장에서 (10, 0)만큼 움직이면 화면에서는 d2 - d, 이를 되돌리면 (10, 0)
    const d2 = pageToDisplay(v, { x: p.x + 10, y: p.y }, scale)
    const delta = displayDeltaToPage(v, d2.x - d.x, d2.y - d.y, scale)
    expect(delta.dx).toBeCloseTo(10, 6)
    expect(delta.dy).toBeCloseTo(0, 6)
    // 끄는 사이 상자가 (0, -30)만큼 스크롤돼도 포인터를 따라간다
    const same = pageDeltaOf(v, { x: 100, y: 100 }, rect, { x: 100, y: 100 }, { left: 40, top: 40 }, scale)
    expect(same.dx * same.dx + same.dy * same.dy).toBeCloseTo(60 * 60, 3)
  })
})

describe('보기 변환 단축키', () => {
  test('R·Shift+R·M·Shift+0이 각각 한 동작에 배정되고 기존 키와 겹치지 않는다', () => {
    expect(actionFor(DEFAULT_KEYMAP, 'R')).toBe('rotateCw')
    expect(actionFor(DEFAULT_KEYMAP, 'Shift+R')).toBe('rotateCcw')
    expect(actionFor(DEFAULT_KEYMAP, 'M')).toBe('mirror')
    expect(actionFor(DEFAULT_KEYMAP, 'Shift+0')).toBe('viewReset')
    expect(actionFor(DEFAULT_KEYMAP, '0')).toBe('zoomFit')
    expect(actionFor(DEFAULT_KEYMAP, 'F')).toBe('focus')
    const all = SHORTCUT_ACTIONS.flatMap((a) => DEFAULT_KEYMAP[a])
    expect(new Set(all).size).toBe(all.length)
  })
})
