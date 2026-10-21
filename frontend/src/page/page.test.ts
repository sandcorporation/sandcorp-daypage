// @vitest-environment node
import * as Y from 'yjs'
import { addStroke, createPageDoc, readStrokes, type Stroke } from './doc'
import { PAGE_WIDTH, fitScale, pageDelta, toPagePoint } from './geometry'
import { orderStrokes } from './render'

function stroke(partial: Partial<Stroke>): Stroke {
  return {
    id: partial.id ?? 's',
    tool: 'pen',
    color: '#2A47B0',
    width: 4,
    points: [0, 0, 0.5],
    author: 'me',
    createdAt: 0,
    ...partial,
  }
}

describe('좌표', () => {
  test('화면 폭에 맞춰 장 전체 폭이 들어가는 배율을 쓴다', () => {
    expect(fitScale(800)).toBe(0.5)
    expect(fitScale(PAGE_WIDTH * 2)).toBe(1)
  })

  test('배율이 달라도 같은 화면 위치는 같은 장 위치가 된다', () => {
    const rect = { left: 100, top: 50 }
    expect(toPagePoint(100 + 200, 50 + 100, rect, 0.5)).toEqual({ x: 400, y: 200 })
    expect(toPagePoint(100 + 400, 50 + 200, rect, 1)).toEqual({ x: 400, y: 200 })
  })
})

describe('장 문서', () => {
  test('그린 획을 저장하고 다시 읽는다', () => {
    const doc = createPageDoc('2026-10-15')
    const s = stroke({ id: 'a', points: [10, 20, 0.5, 30, 40, 0.6] })
    addStroke(doc, s)
    expect(readStrokes(doc)).toEqual([s])
  })

  test('다른 문서에 업데이트를 적용하면 같은 획이 보인다', () => {
    const a = createPageDoc('2026-10-15')
    const b = new Y.Doc()
    addStroke(a, stroke({ id: 'x', tool: 'highlighter' }))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(readStrokes(b).map((s) => s.id)).toEqual(['x'])
  })
})

describe('그리는 순서', () => {
  test('형광펜은 나중에 그려도 펜 아래에 그린다', () => {
    const ordered = orderStrokes([
      stroke({ id: 'pen-1', createdAt: 1 }),
      stroke({ id: 'hl-late', tool: 'highlighter', createdAt: 5 }),
      stroke({ id: 'pen-2', createdAt: 3 }),
      stroke({ id: 'hl-early', tool: 'highlighter', createdAt: 2 }),
    ])
    expect(ordered.map((s) => s.id)).toEqual(['hl-early', 'hl-late', 'pen-1', 'pen-2'])
  })
})

describe('끄는 동안의 장 기준 이동량', () => {
  test('마우스만 움직이면 화면 이동량을 배율로 나눈 만큼', () => {
    const rect = { left: 100, top: 50 }
    expect(pageDelta({ x: 200, y: 200 }, rect, { x: 250, y: 300 }, rect, 0.5)).toEqual({ dx: 100, dy: 200 })
  })

  test('마우스는 그대로인데 스크롤로 장이 올라가면 그만큼 아래로 따라간다', () => {
    const before = { left: 100, top: 50 }
    const scrolled = { left: 100, top: -50 } // 화면에서 장이 100px 올라감
    expect(pageDelta({ x: 200, y: 200 }, before, { x: 200, y: 200 }, scrolled, 0.5)).toEqual({ dx: 0, dy: 200 })
  })
})
