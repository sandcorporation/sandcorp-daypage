import { renderHook, act } from '@testing-library/react'
import type { PointerEvent } from 'react'
import * as Y from 'yjs'
import { takePendingEdits } from './pendingEdits'
import { useEditTools } from './useEditTools'
import { useReorder } from './useReorder'
import { addStroke, readStrokes } from './doc'

const STROKE = { id: 's1', tool: 'pen' as const, color: '#000000', width: 4, points: [100, 100, 0.5, 200, 100, 0.5], author: '나', createdAt: 1 }

const EVENT = { shiftKey: false } as PointerEvent<HTMLDivElement>

function written() {
  const doc = new Y.Doc()
  addStroke(doc, STROKE, null)
  return doc
}

// 놓아야 쓰는 끌기의 같은 꼴(#280): 장이 바뀌는 순간 놓지 않았으면 하나로 센다
describe('놓기 전의 편집', () => {
  test.each([
    ['획 지우개', 'stroke'],
    ['범위 지우개', 'range'],
  ] as const)('%s로 획을 긋는 중이면 세고, 늦게 떼도 지우지 않는다', (_, eraserMode) => {
    const doc = written()
    const { result } = renderHook(() => useEditTools(doc, 'eraser', null, undefined, 1, undefined, 20, null, false, { eraserMode }))
    const tool = result.current.eraserTool
    act(() => void tool.down?.({ x: 150, y: 100 }, EVENT))
    expect(takePendingEdits()).toBe(1)
    expect(takePendingEdits()).toBe(0)
    act(() => tool.up?.({ x: 150, y: 100 }, EVENT))
    expect(readStrokes(doc)).toHaveLength(1)
  })

  test('고른 획을 옮기는 중이면 센다. 움직이지 않았거나 상자로 고르는 중이면 세지 않는다', () => {
    const doc = written()
    const { result } = renderHook(() => useEditTools(doc, 'select', null))
    const drag = (from: [number, number], to?: [number, number]) => {
      act(() => void result.current.pointerTool?.down?.({ x: from[0], y: from[1] }, EVENT))
      if (to) act(() => result.current.pointerTool?.move?.({ x: to[0], y: to[1] }))
      return takePendingEdits()
    }
    expect(drag([150, 100])).toBe(0)
    expect(drag([150, 100], [250, 200])).toBe(1)
    expect(drag([600, 600], [700, 700])).toBe(0)
  })

  test('목록 순서를 끄는 중이면 세고, 늦게 놓아도 옮기지 않는다', () => {
    const moved = vi.fn()
    const { result } = renderHook(() => useReorder(moved))
    const row = (top: number) => ({ getBoundingClientRect: () => ({ top, bottom: top + 20 }) }) as HTMLElement
    result.current.rowProps('a').ref(row(0))
    result.current.rowProps('b').ref(row(20))
    act(() => result.current.handleProps('a').onPointerDown({ button: 0, pointerId: 1, clientY: 10, preventDefault() {} } as never))
    const fire = (type: string) => {
      const e = new window.MouseEvent(type, { clientY: 30, cancelable: true })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      act(() => void window.dispatchEvent(e))
    }
    fire('pointermove')
    expect(takePendingEdits()).toBe(1)
    fire('pointerup')
    expect(moved).not.toHaveBeenCalled()
  })
})
