// @vitest-environment node
import type { Stroke } from './doc'
import { BASE_LAYER_ID, layerPlan, type Layer } from './layers'
import { appendPlan, NOTHING_PAINTED, paintedAfter } from './inkCache'

const base: Layer = { id: BASE_LAYER_ID, name: '레이어 1', order: 0, locked: false, opacity: 1 }
const upper: Layer = { id: 'L2', name: '레이어 2', order: 1, locked: false, opacity: 1 }
const faint: Layer = { id: 'L3', name: '흐린 레이어', order: 2, locked: false, opacity: 0.5 }

function stroke(id: string, createdAt: number, over: Partial<Stroke> = {}): Stroke {
  return { id, tool: 'pen', color: '#000', width: 4, points: [0, 0, 0.5, 10, 10, 0.5], author: '나', createdAt, ...over }
}

describe('전체를 그린 뒤의 기록', () => {
  test('가장 위 레이어와 그 레이어의 마지막 획을 적는다', () => {
    const layers = [base, upper]
    const plan = layerPlan([stroke('a', 1), stroke('b', 2, { layer: 'L2' }), stroke('c', 3)], layers)
    expect(paintedAfter(plan, layers)).toEqual({ layerIndex: 1, last: expect.objectContaining({ id: 'b' }) })
  })

  test('아무것도 없으면 NOTHING_PAINTED', () => {
    expect(paintedAfter(layerPlan([], [base]), [base])).toEqual(NOTHING_PAINTED)
  })
})

describe('덧그리기 판단', () => {
  const layers = [base, upper, faint]

  test('빈 캔버스에는 무엇이든 덧그린다', () => {
    const r = appendPlan(NOTHING_PAINTED, [stroke('a', 1)], layers)
    expect(r?.strokes.map((s) => s.id)).toEqual(['a'])
    expect(r?.painted).toEqual({ layerIndex: 0, last: expect.objectContaining({ id: 'a' }) })
  })

  test('같은 레이어에서 뒤 순서의 펜은 덧그리고, 앞 순서(먼저 그린 시각)면 전체를 다시 그린다', () => {
    const painted = { layerIndex: 0, last: stroke('a', 5) }
    expect(appendPlan(painted, [stroke('b', 6)], layers)?.strokes.map((s) => s.id)).toEqual(['b'])
    expect(appendPlan(painted, [stroke('b', 4)], layers)).toBeNull()
  })

  test('형광펜은 덧그리지 않는다(겹침을 한 덩어리로 합쳐야 한다)', () => {
    expect(appendPlan(NOTHING_PAINTED, [stroke('h', 1, { tool: 'highlighter' })], layers)).toBeNull()
  })

  test('위 레이어의 획은 덧그리고, 아래 레이어의 획은 전체를 다시 그린다', () => {
    const painted = { layerIndex: 1, last: stroke('u', 5, { layer: 'L2' }) }
    expect(appendPlan(painted, [stroke('b', 1)], layers)).toBeNull()
    const painted0 = { layerIndex: 0, last: stroke('a', 9) }
    expect(appendPlan(painted0, [stroke('u', 1, { layer: 'L2' })], layers)?.painted.layerIndex).toBe(1)
  })

  test('흐린 레이어의 획은 덧그리지 않고, 숨긴 레이어의 획은 건너뛴다', () => {
    expect(appendPlan(NOTHING_PAINTED, [stroke('f', 1, { layer: 'L3' })], layers)).toBeNull()
    const r = appendPlan(NOTHING_PAINTED, [stroke('u', 1, { layer: 'L2' }), stroke('a', 2)], layers, new Set(['L2']))
    expect(r?.strokes.map((s) => s.id)).toEqual(['a'])
  })

  test('여러 획이 한 번에 오면 레이어·시각 순으로 정렬해 그린다', () => {
    const r = appendPlan(NOTHING_PAINTED, [stroke('u', 1, { layer: 'L2' }), stroke('b', 3), stroke('a', 2)], layers)
    expect(r?.strokes.map((s) => s.id)).toEqual(['a', 'b', 'u'])
  })
})

test('채색 획은 잉크 캔버스에 덧그리지 않는다(색 캔버스가 맡는다)', () => {
  expect(appendPlan(NOTHING_PAINTED, [stroke('p', 1, { tool: 'paint' })], [base])).toBeNull()
})
