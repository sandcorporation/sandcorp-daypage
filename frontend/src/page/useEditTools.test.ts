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

test('지우개 반지름을 넓히면 멀리 있는 선도 지운다', () => {
  const doc = new Y.Doc()
  addStroke(doc, line('a', 100, 100, 300, 100))
  const small = renderHook(() => useEditTools(doc, 'eraser', 'me', undefined, 1, undefined, 5))
  act(() => void small.result.current.pointerTool?.hover?.({ x: 200, y: 120 }))
  expect(small.result.current.eraseTargets).toEqual([])
  const big = renderHook(() => useEditTools(doc, 'eraser', 'me', undefined, 1, undefined, 25))
  act(() => void big.result.current.pointerTool?.hover?.({ x: 200, y: 120 }))
  expect(big.result.current.eraseTargets).toEqual(['a'])
})

describe('선택 도구 끌기 취소', () => {
  test('옮기던 중 cancel하면 획은 원래 자리이고 미리보기도 없다', () => {
    const doc = new Y.Doc()
    addStroke(doc, line('a', 100, 100, 300, 100))
    const hook = renderHook(() => useEditTools(doc, 'select', 'me'))
    const t = () => hook.result.current.pointerTool
    act(() => void t()?.down?.({ x: 200, y: 102 }, {} as never))
    act(() => void t()?.move?.({ x: 260, y: 182 }))
    expect(hook.result.current.preview?.ids).toEqual(['a'])
    act(() => void t()?.cancel?.())
    expect(hook.result.current.preview).toBeNull()
    expect(readStrokes(doc)[0].points).toEqual([100, 100, 0.5, 300, 100, 0.5])
    // 취소된 뒤의 up은 아무것도 바꾸지 않는다
    act(() => void t()?.up?.({ x: 260, y: 182 }, {} as never))
    expect(readStrokes(doc)[0].points).toEqual([100, 100, 0.5, 300, 100, 0.5])
  })
})

describe('내가 그린 획만 고르기', () => {
  function others(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
    return { ...line(id, x1, y1, x2, y2), author: '남' }
  }
  function setupMine() {
    const doc = new Y.Doc()
    addStroke(doc, line('mine', 100, 100, 300, 100))
    addStroke(doc, others('theirs', 100, 300, 300, 300))
    const hook = renderHook(() => useEditTools(doc, 'select', 'me', undefined, 1, undefined, undefined, '나'))
    return { doc, hook, t: () => hook.result.current.pointerTool }
  }

  test('남의 획을 눌러 끌어도 고르거나 옮기지 않는다', () => {
    const { doc, hook, t } = setupMine()
    act(() => void t()?.down?.({ x: 200, y: 302 }, {} as never))
    act(() => void t()?.move?.({ x: 260, y: 382 }))
    expect(hook.result.current.preview).toBeNull()
    expect(hook.result.current.selected).toEqual([])
    act(() => void t()?.up?.({ x: 260, y: 382 }, {} as never))
    expect(readStrokes(doc).find((s) => s.id === 'theirs')?.points).toEqual([100, 300, 0.5, 300, 300, 0.5])
  })

  test('내 획은 평소처럼 옮긴다', () => {
    const { doc, hook, t } = setupMine()
    act(() => void t()?.down?.({ x: 200, y: 102 }, {} as never))
    act(() => void t()?.move?.({ x: 210, y: 112 }))
    expect(hook.result.current.preview?.ids).toEqual(['mine'])
    act(() => void t()?.up?.({ x: 210, y: 112 }, {} as never))
    expect(readStrokes(doc).find((s) => s.id === 'mine')?.points).toEqual([110, 110, 0.5, 310, 110, 0.5])
  })

  test('상자로 둘러도 내 획만 골라지고, 남의 획 위에서는 옮기기 커서가 아니다', () => {
    const { hook, t } = setupMine()
    act(() => void t()?.down?.({ x: 50, y: 50 }, {} as never))
    act(() => void t()?.move?.({ x: 350, y: 350 }))
    act(() => void t()?.up?.({ x: 350, y: 350 }, {} as never))
    expect(hook.result.current.selected).toEqual(['mine'])
    let cursor: string | null | undefined
    act(() => void (cursor = t()?.hover?.({ x: 200, y: 302 })))
    expect(cursor).toBeNull()
  })

  test('설정을 끄면(사람을 넘기지 않으면) 남의 획도 고른다', () => {
    const doc = new Y.Doc()
    addStroke(doc, others('theirs', 100, 300, 300, 300))
    const hook = renderHook(() => useEditTools(doc, 'select', 'me'))
    act(() => void hook.result.current.pointerTool?.down?.({ x: 200, y: 302 }, {} as never))
    expect(hook.result.current.selected).toEqual(['theirs'])
  })
})
