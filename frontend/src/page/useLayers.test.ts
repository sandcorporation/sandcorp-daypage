import { act, renderHook } from '@testing-library/react'
import * as Y from 'yjs'
import { addStroke, type Stroke } from './doc'
import { addLayer } from './layers'
import { STROKE_CHANGE_THROTTLE_MS, useLayerList, useLayers } from './useLayers'

function line(id: string, layer?: string): Stroke {
  return { id, tool: 'pen', color: '#000', width: 4, points: [0, 0, 0.5, 10, 10, 0.5], author: '나', createdAt: 1, ...(layer ? { layer } : {}) }
}

afterEach(() => vi.useRealTimers())

test('레이어 목록만 쓰는 쪽은 획이 바뀌어도 다시 렌더하지 않고, 레이어가 바뀌면 다시 읽는다', () => {
  const doc = new Y.Doc()
  let renders = 0
  const hook = renderHook(() => {
    renders++
    return useLayerList(doc)
  })
  const before = renders
  act(() => addStroke(doc, line('a')))
  expect(renders).toBe(before)
  act(() => void addLayer(doc))
  expect(hook.result.current).toHaveLength(2)
})

test('레이어별 획 수는 획이 바뀌면 잠시 모아 한 번만 다시 센다', () => {
  vi.useFakeTimers()
  const doc = new Y.Doc()
  const hook = renderHook(() => useLayers(doc))
  const base = hook.result.current.layers[0].id
  act(() => {
    addStroke(doc, line('a'))
    addStroke(doc, line('b'))
  })
  expect(hook.result.current.stats.get(base)?.count ?? 0).toBe(0)
  act(() => void vi.advanceTimersByTime(STROKE_CHANGE_THROTTLE_MS))
  expect(hook.result.current.stats.get(base)?.count).toBe(2)
})
