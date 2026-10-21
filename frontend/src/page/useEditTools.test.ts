import { act, renderHook } from '@testing-library/react'
import * as Y from 'yjs'
import { addStroke, readStrokes, type Stroke } from './doc'
import { useEditTools } from './useEditTools'

function line(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
  return { id, tool: 'pen', color: '#2A47B0', width: 4, points: [x1, y1, 0.5, x2, y2, 0.5], author: '나', createdAt: 1 }
}

function setup() {
  const doc = new Y.Doc()
  addStroke(doc, line('a', 100, 100, 300, 100))
  addStroke(doc, line('b', 100, 300, 300, 300))
  const hook = renderHook(() => useEditTools(doc, 'eraser', 'me'))
  return { doc, hook }
}

describe('지우개 미리보기', () => {
  test('지우개를 선 위에 올리면 누르면 지워질 선을 알려 주고, 문서는 그대로다', () => {
    const { doc, hook } = setup()
    act(() => void hook.result.current.pointerTool?.hover?.({ x: 200, y: 104 }))
    expect(hook.result.current.eraseTargets).toEqual(['a'])
    expect(readStrokes(doc).map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  test('선에서 벗어나거나 페이지를 떠나면 표시를 지운다', () => {
    const { hook } = setup()
    act(() => void hook.result.current.pointerTool?.hover?.({ x: 200, y: 104 }))
    act(() => void hook.result.current.pointerTool?.hover?.({ x: 200, y: 200 }))
    expect(hook.result.current.eraseTargets).toEqual([])
    act(() => void hook.result.current.pointerTool?.hover?.({ x: 200, y: 300 }))
    expect(hook.result.current.eraseTargets).toEqual(['b'])
    act(() => void hook.result.current.pointerTool?.hover?.(null))
    expect(hook.result.current.eraseTargets).toEqual([])
  })

  test('끄는 동안은 지나간 선을 흐리게만 보이고, 손을 떼야 한 번에 지운다', () => {
    const { doc, hook } = setup()
    const t = () => hook.result.current.pointerTool
    act(() => void t()?.down?.({ x: 200, y: 104 }, {} as never))
    expect(hook.result.current.eraseTargets).toEqual(['a'])
    expect(readStrokes(doc).map((s) => s.id).sort()).toEqual(['a', 'b'])
    act(() => void t()?.move?.({ x: 200, y: 300 }))
    expect(hook.result.current.eraseTargets).toEqual(['a', 'b'])
    expect(readStrokes(doc).map((s) => s.id).sort()).toEqual(['a', 'b'])
    act(() => void t()?.up?.({ x: 200, y: 300 }, {} as never))
    expect(readStrokes(doc)).toEqual([])
    expect(hook.result.current.eraseTargets).toEqual([])
  })

  test('두 번째 손가락이 닿아 취소되면 아무것도 지우지 않는다', () => {
    const { doc, hook } = setup()
    const t = () => hook.result.current.pointerTool
    act(() => void t()?.down?.({ x: 200, y: 104 }, {} as never))
    act(() => void t()?.move?.({ x: 200, y: 300 }))
    act(() => void t()?.cancel?.())
    expect(readStrokes(doc).map((s) => s.id).sort()).toEqual(['a', 'b'])
    expect(hook.result.current.eraseTargets).toEqual([])
    // 취소된 뒤의 move는 아무것도 하지 않는다
    act(() => void t()?.move?.({ x: 200, y: 104 }))
    expect(hook.result.current.eraseTargets).toEqual([])
  })

  test('눌러서 지우면 지운 선의 표시는 남지 않는다', () => {
    const { doc, hook } = setup()
    act(() => void hook.result.current.pointerTool?.hover?.({ x: 200, y: 104 }))
    act(() => {
      const t = hook.result.current.pointerTool
      t?.down?.({ x: 200, y: 104 }, {} as never)
      t?.up?.({ x: 200, y: 104 }, {} as never)
    })
    expect(readStrokes(doc).map((s) => s.id)).toEqual(['b'])
    expect(hook.result.current.eraseTargets).toEqual([])
  })
})
