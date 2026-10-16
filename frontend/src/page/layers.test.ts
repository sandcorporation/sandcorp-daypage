import * as Y from 'yjs'
import { addStroke, createPageDoc, readStrokes, type Stroke } from './doc'
import { addLayer, BASE_LAYER_ID, layerOf, layerPlan, MAX_LAYERS, readLayers } from './layers'

function stroke(partial: Partial<Stroke>): Stroke {
  return { id: 's', tool: 'pen', color: '#000000', width: 6, points: [0, 0, 0.5], author: 'me', createdAt: 0, ...partial }
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
}

describe('기본 레이어', () => {
  test('레이어를 쓰지 않은 페이지에는 기본 레이어 하나가 있고, 문서는 바뀌지 않는다', () => {
    const doc = createPageDoc('2026-10-16')
    const before = Y.encodeStateAsUpdate(doc)
    expect(readLayers(doc)).toEqual([{ id: BASE_LAYER_ID, name: '레이어 1', order: 0, locked: false, opacity: 1 }])
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  test('레이어 정보가 없는 옛 획은 기본 레이어에 있다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'old' }))
    expect(layerOf(readStrokes(doc)[0], readLayers(doc))).toBe(BASE_LAYER_ID)
  })
})

describe('새 레이어', () => {
  test('새 레이어는 맨 위에 생기고 이름이 붙는다', () => {
    const doc = createPageDoc('2026-10-16')
    const id = addLayer(doc)!
    const layers = readLayers(doc)
    expect(layers.map((l) => l.id)).toEqual([BASE_LAYER_ID, id])
    expect(layers[1].name).toBe('레이어 2')
  })

  test(`페이지당 ${MAX_LAYERS}개까지`, () => {
    const doc = createPageDoc('2026-10-16')
    for (let i = 1; i < MAX_LAYERS; i++) expect(addLayer(doc)).not.toBeNull()
    expect(addLayer(doc)).toBeNull()
    expect(readLayers(doc)).toHaveLength(MAX_LAYERS)
  })

  test('지금 그리는 레이어에 그린 획은 그 레이어에 남고 다른 문서에서도 같다', () => {
    const a = createPageDoc('2026-10-16')
    const top = addLayer(a)!
    addStroke(a, stroke({ id: 'x', layer: top }))
    const b = new Y.Doc()
    sync(a, b)
    expect(layerOf(readStrokes(b)[0], readLayers(b))).toBe(top)
  })

  test('없는 레이어를 가리키는 획은 기본 레이어(없으면 맨 아래)로 본다', () => {
    const doc = createPageDoc('2026-10-16')
    addLayer(doc)
    expect(layerOf(stroke({ layer: 'gone' }), readLayers(doc))).toBe(BASE_LAYER_ID)
  })

  test('두 사람이 동시에 레이어를 만들어도 둘 다 남는다', () => {
    const a = createPageDoc('2026-10-16')
    const b = new Y.Doc()
    sync(a, b)
    addLayer(a)
    addLayer(b)
    sync(a, b)
    expect(readLayers(a)).toHaveLength(3)
    expect(readLayers(a).map((l) => l.id)).toEqual(readLayers(b).map((l) => l.id))
  })
})

describe('그리는 순서', () => {
  test('레이어 순서(아래→위)대로, 레이어 안에서는 형광펜 아래·펜 위', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    const layers = readLayers(doc)
    const plan = layerPlan(
      [
        stroke({ id: 'top-pen', layer: top, createdAt: 1 }),
        stroke({ id: 'base-hl', tool: 'highlighter', createdAt: 5 }),
        stroke({ id: 'base-pen', createdAt: 2 }),
        stroke({ id: 'top-hl', tool: 'highlighter', layer: top, createdAt: 9 }),
      ],
      layers,
    )
    expect(plan.map((p) => [p.layer.id, p.strokes.map((s) => s.id)])).toEqual([
      [BASE_LAYER_ID, ['base-hl', 'base-pen']],
      [top, ['top-hl', 'top-pen']],
    ])
  })
})
