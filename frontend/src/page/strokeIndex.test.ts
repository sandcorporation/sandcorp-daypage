import { act, renderHook } from '@testing-library/react'
import * as Y from 'yjs'
import { addStroke, deleteStrokes, moveStrokes, type Stroke } from './doc'
import { pathBounds } from './hit'
import { buildStrokeIndex, StrokeIndex, useStrokeIndex } from './strokeIndex'

function line(id: string, x1: number, y1: number, x2: number, y2: number, width = 4): Stroke {
  return { id, tool: 'pen', color: '#000', width, points: [x1, y1, 0.5, x2, y2, 0.5], author: '나', createdAt: 1 }
}

describe('획 공간 색인', () => {
  test('근처 칸의 획만 후보로 돌려준다', () => {
    const index = buildStrokeIndex([line('a', 10, 10, 50, 20), line('b', 900, 900, 950, 950)])
    expect(index.near({ x: 0, y: 0, width: 60, height: 60 })).toEqual(['a'])
    expect(index.near({ x: 880, y: 880, width: 10, height: 10 })).toEqual(['b'])
    expect(index.near({ x: 400, y: 400, width: 10, height: 10 })).toEqual([])
  })

  test('긴 획은 걸치는 모든 칸에서 찾고, 굵기만큼 넓힌 경계를 쓴다', () => {
    const index = buildStrokeIndex([line('long', 50, 150, 1250, 150), line('fat', 300, 300, 300, 300, 40)])
    expect(index.near({ x: 700, y: 140, width: 1, height: 1 })).toEqual(['long'])
    // 굵기 40의 점 획은 (280..320, 280..320)을 덮으므로 (285, 285) 근처 칸(2,2)에서 찾힌다
    expect(index.near({ x: 285, y: 285, width: 1, height: 1 })).toEqual(['fat'])
  })

  test('지우면 빠지고, 다시 넣으면 새 자리로 옮긴다', () => {
    const index = new StrokeIndex()
    index.set(line('a', 10, 10, 20, 20))
    index.set(line('a', 500, 500, 520, 520))
    expect(index.near({ x: 0, y: 0, width: 50, height: 50 })).toEqual([])
    expect(index.near({ x: 500, y: 500, width: 1, height: 1 })).toEqual(['a'])
    index.remove('a')
    expect(index.size).toBe(0)
    expect(index.near({ x: 500, y: 500, width: 1, height: 1 })).toEqual([])
  })

  test('점이 없는 획은 색인에 넣지 않아도 깨지지 않는다', () => {
    const index = new StrokeIndex()
    index.set({ ...line('e', 0, 0, 0, 0), points: [] })
    expect(index.near({ x: 0, y: 0, width: 10, height: 10 })).toEqual([])
  })

  test('경로 경계 상자는 반지름만큼 넓힌다', () => {
    expect(pathBounds([{ x: 10, y: 20 }, { x: 30, y: 25 }], 5)).toEqual({ x: 5, y: 15, width: 30, height: 15 })
  })
})

describe('문서를 따라가는 색인', () => {
  test('획을 더하고·옮기고·지우면 색인이 따라간다', () => {
    const doc = new Y.Doc()
    addStroke(doc, line('a', 10, 10, 20, 20))
    const hook = renderHook(() => useStrokeIndex(doc))
    const at = (x: number, y: number) => hook.result.current().near({ x, y, width: 1, height: 1 })
    expect(at(10, 10)).toEqual(['a'])
    act(() => addStroke(doc, line('b', 700, 700, 720, 720)))
    expect(at(710, 710)).toEqual(['b'])
    act(() => moveStrokes(doc, ['a'], 500, 500))
    expect(at(10, 10)).toEqual([])
    expect(at(510, 510)).toEqual(['a'])
    act(() => deleteStrokes(doc, ['b']))
    expect(at(710, 710)).toEqual([])
    expect(hook.result.current().size).toBe(1)
  })
})
