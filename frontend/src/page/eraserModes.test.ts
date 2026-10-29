import { act, renderHook } from '@testing-library/react'
import * as Y from 'yjs'
import { addStroke, readStrokes, type Stroke } from './doc'
import type { EraseFilter, EraserMode } from './erase'
import { createUndoManager } from './undo'
import { useEditTools } from './useEditTools'
import { addLayer, setLayerLocked } from './layers'

function line(id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<Stroke> = {}): Stroke {
  const points: number[] = []
  const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 10))
  for (let k = 0; k <= n; k++) points.push(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n, 0.5)
  return { id, tool: 'pen', color: '#2A47B0', width: 4, points, author: '나', createdAt: 1, ...extra }
}

const origin = { local: true }

function setup(mode: EraserMode, filter: EraseFilter = 'all', tool: 'eraser' | 'pen' = 'eraser') {
  const doc = new Y.Doc()
  addStroke(doc, line('aaaaaaaaaaaaaaaa', 100, 100, 300, 100))
  addStroke(doc, line('hhhhhhhhhhhhhhhh', 100, 300, 300, 300, { tool: 'highlighter', width: 14 }))
  const hook = renderHook(() =>
    useEditTools(doc, tool, origin, undefined, 1, undefined, 10, null, false, { eraserMode: mode, eraseFilter: filter }),
  )
  return { doc, hook }
}

function rub(t: ReturnType<typeof setup>['hook'], path: { x: number; y: number }[], which: 'pointerTool' | 'eraserTool' = 'pointerTool') {
  const tool = () => t.result.current[which]
  act(() => void tool()?.down?.(path[0], {} as never))
  for (const p of path.slice(1)) act(() => void tool()?.move?.(p))
  act(() => void tool()?.up?.(path[path.length - 1], {} as never))
}

const ids = (doc: Y.Doc) => readStrokes(doc).map((s) => s.id)

describe('범위 지우개', () => {
  test('획 가운데를 문지르면 손을 뗄 때 두 조각이 남고, 되돌리기 한 번에 원래대로', () => {
    const { doc, hook } = setup('range')
    const um = createUndoManager(doc, origin)
    rub(hook, [
      { x: 200, y: 80 },
      { x: 200, y: 100 },
      { x: 200, y: 120 },
    ])
    const pieces = readStrokes(doc).filter((s) => s.id.startsWith('a'))
    expect(pieces).toHaveLength(2)
    expect(pieces.every((s) => s.id.length === 20)).toBe(true)
    um.undo()
    expect(ids(doc).sort()).toEqual(['aaaaaaaaaaaaaaaa', 'hhhhhhhhhhhhhhhh'])
  })

  test('문지르는 동안은 문서를 바꾸지 않는다(다른 화면에 반쯤 지운 상태가 가지 않게)', () => {
    const { doc, hook } = setup('range')
    let updates = 0
    doc.on('update', () => updates++)
    const t = () => hook.result.current.pointerTool
    act(() => void t()?.down?.({ x: 150, y: 100 }, {} as never))
    for (let x = 150; x < 250; x += 5) act(() => void t()?.move?.({ x, y: 100 }))
    expect(updates).toBe(0)
    act(() => void t()?.up?.({ x: 250, y: 100 }, {} as never))
    expect(updates).toBe(1)
  })

  test('채움 도형은 자르지 않고 통째로 지운다(끄는 동안 지워질 획으로 보인다)', () => {
    const { doc, hook } = setup('range')
    addStroke(doc, { ...line('ffffffffffffffff', 500, 500, 600, 500), fill: 0.6 })
    const t = () => hook.result.current.pointerTool
    act(() => void t()?.down?.({ x: 550, y: 500 }, {} as never))
    expect(hook.result.current.live.eraseTargets).toEqual(['ffffffffffffffff'])
    act(() => void t()?.up?.({ x: 550, y: 500 }, {} as never))
    expect(ids(doc)).not.toContain('ffffffffffffffff')
    expect(ids(doc).filter((id) => id.startsWith('f'))).toEqual([])
  })

  test('거르기: 형광펜만이면 펜 획은 그대로 둔다', () => {
    const { doc, hook } = setup('range', 'highlighter')
    rub(hook, [
      { x: 200, y: 60 },
      { x: 200, y: 340 },
    ])
    expect(ids(doc)).toContain('aaaaaaaaaaaaaaaa')
    expect(readStrokes(doc).filter((s) => s.tool === 'highlighter')).toHaveLength(2)
  })
})

describe('획 지우개 거르기', () => {
  test('펜만이면 형광펜은 남는다', () => {
    const { doc, hook } = setup('stroke', 'pen')
    rub(hook, [
      { x: 200, y: 60 },
      { x: 200, y: 340 },
    ])
    expect(ids(doc)).toEqual(['hhhhhhhhhhhhhhhh'])
  })
})

describe('올가미 지우개', () => {
  test('둘러싼 영역 안의 획만 지운다', () => {
    const { doc, hook } = setup('lasso')
    rub(hook, [
      { x: 50, y: 50 },
      { x: 350, y: 50 },
      { x: 350, y: 150 },
      { x: 50, y: 150 },
    ])
    expect(ids(doc)).toEqual(['hhhhhhhhhhhhhhhh'])
  })

  test('점 두 개로는 아무것도 지우지 않는다', () => {
    const { doc, hook } = setup('lasso')
    rub(hook, [
      { x: 50, y: 100 },
      { x: 350, y: 100 },
    ])
    expect(ids(doc)).toHaveLength(2)
  })
})

describe('이 장 모두 지우기', () => {
  test('지금 레이어의 획만, 거르기를 따라 한 번에 지우고 되돌리기 한 번에 살아난다', () => {
    const doc = new Y.Doc()
    addStroke(doc, line('a', 100, 100, 300, 100))
    addStroke(doc, line('h', 100, 300, 300, 300, { tool: 'highlighter' }))
    const other = addLayer(doc)!
    addStroke(doc, line('o', 100, 500, 300, 500, { layer: other }))
    const um = createUndoManager(doc, origin)
    const hook = renderHook(() => useEditTools(doc, 'pen', origin, undefined, 1, 'base', 10, null, false, { eraseFilter: 'all' }))
    expect(hook.result.current.clearTargets().sort()).toEqual(['a', 'h'])
    let n = 0
    act(() => void (n = hook.result.current.clearAll()))
    expect(n).toBe(2)
    expect(ids(doc)).toEqual(['o'])
    um.undo()
    expect(ids(doc).sort()).toEqual(['a', 'h', 'o'])
  })

  test('잠긴 레이어의 획은 지우지 않는다', () => {
    const doc = new Y.Doc()
    addStroke(doc, line('a', 100, 100, 300, 100))
    setLayerLocked(doc, 'base', true)
    const hook = renderHook(() => useEditTools(doc, 'pen', origin, undefined, 1, 'base', 10))
    expect(hook.result.current.clearTargets()).toEqual([])
  })
})

describe('펜 지우개 버튼으로 쓰는 지우개', () => {
  test('지금 도구가 펜이어도 eraserTool은 고른 방식(범위)으로 지운다', () => {
    const { doc, hook } = setup('range', 'all', 'pen')
    expect(hook.result.current.pointerTool).toBeUndefined()
    rub(
      hook,
      [
        { x: 200, y: 80 },
        { x: 200, y: 120 },
      ],
      'eraserTool',
    )
    expect(readStrokes(doc).filter((s) => s.id.startsWith('a'))).toHaveLength(2)
  })
})
