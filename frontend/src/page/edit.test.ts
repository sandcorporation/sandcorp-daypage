// @vitest-environment node
import { addStroke, createPageDoc, moveStrokes, readStrokes, type Stroke } from './doc'
import { strokeBounds, strokesHitBy, strokesInRect, topStrokeAt } from './hit'
import { createUndoManager } from './undo'

function line(id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<Stroke> = {}): Stroke {
  return {
    id,
    tool: 'pen',
    color: '#000',
    width: 4,
    points: [x1, y1, 0.5, x2, y2, 0.5],
    author: 'me',
    createdAt: 1,
    ...extra,
  }
}

describe('지우개 히트 테스트', () => {
  const strokes = [line('near', 0, 0, 100, 0), line('far', 0, 200, 100, 200)]

  test('지우개 경로에 닿은 획만 고른다', () => {
    expect(strokesHitBy(strokes, [{ x: 50, y: 5 }], 8)).toEqual(['near'])
  })

  test('경로 점 사이를 빠르게 지나가도 그 사이의 획을 놓치지 않는다', () => {
    expect(strokesHitBy(strokes, [{ x: 50, y: -100 }, { x: 50, y: 300 }], 4).sort()).toEqual(['far', 'near'])
  })

  test('닿지 않으면 아무것도 고르지 않는다', () => {
    expect(strokesHitBy(strokes, [{ x: 50, y: 100 }], 8)).toEqual([])
  })
})

describe('선택', () => {
  test('겹친 획 중 위에 그려진 획을 고른다', () => {
    const below = line('below', 0, 0, 100, 0, { createdAt: 1 })
    const above = line('above', 0, 0, 100, 0, { createdAt: 2 })
    const hl = line('hl', 0, 0, 100, 0, { tool: 'highlighter', createdAt: 3 })
    expect(topStrokeAt([below, above, hl], { x: 50, y: 0 }, 6)?.id).toBe('above')
  })

  test('사각형 안에 걸친 획을 모두 고른다', () => {
    const strokes = [line('a', 10, 10, 20, 20), line('b', 500, 500, 520, 520)]
    expect(strokesInRect(strokes, { x: 0, y: 0, width: 100, height: 100 })).toEqual(['a'])
  })

  test('획의 경계 상자는 굵기만큼 넓다', () => {
    expect(strokeBounds(line('a', 10, 10, 30, 20))).toEqual({ x: 8, y: 8, width: 24, height: 14 })
  })
})

describe('되돌리기', () => {
  test('두 사람의 변경이 섞여 있어도 내 변경만 되돌린다', () => {
    const doc = createPageDoc('2026-10-15')
    const mine = { me: true }
    const undo = createUndoManager(doc, mine)
    addStroke(doc, line('mine', 0, 0, 1, 1), mine)
    addStroke(doc, line('theirs', 0, 0, 1, 1)) // 원격 변경(다른 origin)
    undo.undo()
    expect(readStrokes(doc).map((s) => s.id)).toEqual(['theirs'])
    undo.redo()
    expect(readStrokes(doc).map((s) => s.id).sort()).toEqual(['mine', 'theirs'])
  })

  test('옮긴 획을 되돌리면 원위치로 돌아간다', () => {
    const doc = createPageDoc('2026-10-15')
    const mine = {}
    const undo = createUndoManager(doc, mine)
    addStroke(doc, line('a', 0, 0, 10, 0), mine)
    undo.stopCapturing()
    moveStrokes(doc, ['a'], 5, 7, mine)
    expect(readStrokes(doc)[0].points).toEqual([5, 7, 0.5, 15, 7, 0.5])
    undo.undo()
    expect(readStrokes(doc)[0].points).toEqual([0, 0, 0.5, 10, 0, 0.5])
  })
})
