// @vitest-environment node
import * as Y from 'yjs'
import { addStroke, createPageDoc, readStrokes, type Stroke } from './doc'
import {
  addLayer,
  BASE_LAYER_ID,
  canDrawOn,
  deleteLayer,
  editableStrokes,
  erasableStrokes,
  grabIds,
  highlightPlan,
  layerOf,
  layerPlan,
  MAX_LAYERS,
  moveLayer,
  readLayers,
  renameLayer,
  setLayerLocked,
  setLayerOpacity,
} from './layers'
import { createUndoManager } from './undo'

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

describe('이름·순서·불투명도', () => {
  test('이름을 바꾸면 다른 문서에도 반영된다. 빈 이름은 무시하고 길면 자른다', () => {
    const a = createPageDoc('2026-10-16')
    renameLayer(a, BASE_LAYER_ID, '  밑그림  ')
    renameLayer(a, BASE_LAYER_ID, '   ')
    const b = new Y.Doc()
    sync(a, b)
    expect(readLayers(b)[0].name).toBe('밑그림')
    renameLayer(a, BASE_LAYER_ID, '가'.repeat(40))
    expect(readLayers(a)[0].name).toHaveLength(20)
  })

  test('순서를 바꾸면 위에 있는 레이어가 앞에 그려진다', () => {
    const doc = createPageDoc('2026-10-16')
    const b = addLayer(doc)!
    const c = addLayer(doc)!
    moveLayer(doc, c, 0) // 맨 아래로
    expect(readLayers(doc).map((l) => l.id)).toEqual([c, BASE_LAYER_ID, b])
    moveLayer(doc, BASE_LAYER_ID, 2) // 맨 위로
    expect(readLayers(doc).map((l) => l.id)).toEqual([c, b, BASE_LAYER_ID])
  })

  test('두 사람이 동시에 순서를 바꿔도 합친 결과가 같다', () => {
    const a = createPageDoc('2026-10-16')
    const l2 = addLayer(a)!
    const l3 = addLayer(a)!
    const b = new Y.Doc()
    sync(a, b)
    moveLayer(a, l3, 0)
    moveLayer(b, BASE_LAYER_ID, 2)
    sync(a, b)
    const ids = readLayers(a).map((l) => l.id)
    expect(readLayers(b).map((l) => l.id)).toEqual(ids)
    expect(new Set(ids)).toEqual(new Set([BASE_LAYER_ID, l2, l3]))
  })

  test('불투명도는 10%~100% 사이로 저장된다', () => {
    const doc = createPageDoc('2026-10-16')
    setLayerOpacity(doc, BASE_LAYER_ID, 0.4)
    expect(readLayers(doc)[0].opacity).toBe(0.4)
    setLayerOpacity(doc, BASE_LAYER_ID, 0)
    expect(readLayers(doc)[0].opacity).toBe(0.1)
  })

  test('내 화면에서 숨긴 레이어는 그리지 않고, 숨기지 않으면(기록·이미지 저장) 모두 그린다', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    const strokes = [stroke({ id: 'a' }), stroke({ id: 'b', layer: top })]
    expect(layerPlan(strokes, readLayers(doc), new Set([top])).map((p) => p.layer.id)).toEqual([BASE_LAYER_ID])
    expect(layerPlan(strokes, readLayers(doc)).map((p) => p.layer.id)).toEqual([BASE_LAYER_ID, top])
  })

  test('레이어 바꾸기는 내 작업으로 되돌릴 수 있다', () => {
    const doc = createPageDoc('2026-10-16')
    const origin = { local: true }
    const undo = createUndoManager(doc, origin)
    renameLayer(doc, BASE_LAYER_ID, '밑그림', origin)
    undo.stopCapturing()
    setLayerOpacity(doc, BASE_LAYER_ID, 0.5, origin)
    undo.undo()
    expect(readLayers(doc)[0]).toMatchObject({ name: '밑그림', opacity: 1 })
    undo.undo()
    expect(readLayers(doc)[0].name).toBe('레이어 1')
  })
})

describe('잠그기', () => {
  test('잠그면 모두에게 반영되고 누구나 풀 수 있다', () => {
    const a = createPageDoc('2026-10-16')
    setLayerLocked(a, BASE_LAYER_ID, true)
    const b = new Y.Doc()
    sync(a, b)
    expect(readLayers(b)[0].locked).toBe(true)
    setLayerLocked(b, BASE_LAYER_ID, false)
    sync(a, b)
    expect(readLayers(a)[0].locked).toBe(false)
  })

  test('잠긴 레이어와 내가 숨긴 레이어의 획은 지우개·선택 대상이 아니다', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    const third = addLayer(doc)!
    setLayerLocked(doc, BASE_LAYER_ID, true)
    const strokes = [stroke({ id: 'base' }), stroke({ id: 'top', layer: top }), stroke({ id: 'third', layer: third })]
    const ids = editableStrokes(strokes, readLayers(doc), new Set([third])).map((s) => s.id)
    expect(ids).toEqual(['top'])
  })


  test('지우개는 지금 그리는 레이어의 획만 지운다(다른 레이어 그림은 남는다)', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    const strokes = [stroke({ id: 'base' }), stroke({ id: 'old' }), stroke({ id: 'top', layer: top })]
    const layers = readLayers(doc)
    expect(erasableStrokes(strokes, layers, top).map((s) => s.id)).toEqual(['top'])
    expect(erasableStrokes(strokes, layers, BASE_LAYER_ID).map((s) => s.id)).toEqual(['base', 'old'])
  })

  test('지금 레이어가 잠겼거나 숨겨졌으면 지울 것이 없다', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    const strokes = [stroke({ id: 'top', layer: top })]
    expect(erasableStrokes(strokes, readLayers(doc), top, new Set([top]))).toEqual([])
    setLayerLocked(doc, top, true)
    expect(erasableStrokes(strokes, readLayers(doc), top)).toEqual([])
  })
  test('잠긴 레이어에는 그릴 수 없다', () => {
    const doc = createPageDoc('2026-10-16')
    expect(canDrawOn(readLayers(doc), BASE_LAYER_ID)).toBe(true)
    setLayerLocked(doc, BASE_LAYER_ID, true)
    expect(canDrawOn(readLayers(doc), BASE_LAYER_ID)).toBe(false)
  })

  test('잠금·풀기는 내 작업으로 되돌릴 수 있다', () => {
    const doc = createPageDoc('2026-10-16')
    const origin = { local: true }
    const undo = createUndoManager(doc, origin)
    setLayerLocked(doc, BASE_LAYER_ID, true, origin)
    undo.undo()
    expect(readLayers(doc)[0].locked).toBe(false)
  })
})

describe('지우기', () => {
  test('레이어를 지우면 그 레이어의 획(남의 획 포함)도 함께 사라지고 모두에게 반영된다', () => {
    const a = createPageDoc('2026-10-16')
    const top = addLayer(a)!
    addStroke(a, stroke({ id: 'mine', layer: top }))
    addStroke(a, stroke({ id: 'theirs', layer: top, author: '푸른 펭귄' }))
    addStroke(a, stroke({ id: 'base' }))
    expect(deleteLayer(a, top)).toBe(true)
    const b = new Y.Doc()
    sync(a, b)
    expect(readLayers(b).map((l) => l.id)).toEqual([BASE_LAYER_ID])
    expect(readStrokes(b).map((s) => s.id)).toEqual(['base'])
  })

  test('되돌리면 레이어와 획이 함께 돌아오고, 남이 그 뒤에 한 작업은 되돌리지 않는다', () => {
    const doc = createPageDoc('2026-10-16')
    const origin = { local: true }
    const undo = createUndoManager(doc, origin)
    const top = addLayer(doc)!
    addStroke(doc, stroke({ id: 'x', layer: top }))
    undo.stopCapturing()
    deleteLayer(doc, top, origin)
    addStroke(doc, stroke({ id: 'other' }), { remote: true })
    undo.undo()
    expect(readLayers(doc).map((l) => l.id)).toEqual([BASE_LAYER_ID, top])
    expect(readStrokes(doc).map((s) => s.id).sort()).toEqual(['other', 'x'])
  })

  test('마지막 남은 레이어는 지울 수 없다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'a' }))
    expect(deleteLayer(doc, BASE_LAYER_ID)).toBe(false)
    expect(readStrokes(doc)).toHaveLength(1)
  })

  test('기본 레이어를 지우면 옛 획(레이어 정보 없음)도 함께 지운다', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    addStroke(doc, stroke({ id: 'old' }))
    addStroke(doc, stroke({ id: 'new', layer: top }))
    deleteLayer(doc, BASE_LAYER_ID)
    expect(readStrokes(doc).map((s) => s.id)).toEqual(['new'])
    expect(layerOf(readStrokes(doc)[0], readLayers(doc))).toBe(top)
  })
})

describe('리뷰에서 찾은 경우', () => {
  test('레이어가 하나뿐일 때 옮기기는 아무것도 하지 않는다(순서가 깨지지 않는다)', () => {
    const doc = createPageDoc('2026-10-16')
    moveLayer(doc, BASE_LAYER_ID, 1)
    moveLayer(doc, BASE_LAYER_ID, -1)
    const id = addLayer(doc)!
    expect(readLayers(doc).map((l) => l.id)).toEqual([BASE_LAYER_ID, id])
    expect(readLayers(doc).every((l) => Number.isFinite(l.order))).toBe(true)
  })

  test('두 사람이 새 페이지에서 동시에 처음 기본 레이어를 고쳐도 둘 다 남는다', () => {
    const a = createPageDoc('2026-10-16')
    const b = new Y.Doc()
    sync(a, b)
    renameLayer(a, BASE_LAYER_ID, '밑그림')
    setLayerLocked(b, BASE_LAYER_ID, true)
    sync(a, b)
    expect(readLayers(a)[0]).toMatchObject({ name: '밑그림', locked: true })
    expect(readLayers(b)[0]).toMatchObject({ name: '밑그림', locked: true })
  })

  test('내 첫 레이어 변경을 되돌려도 공용 기본 레이어와 그 획은 그대로다', () => {
    const a = createPageDoc('2026-10-16')
    const origin = { local: true }
    const undo = createUndoManager(a, origin)
    addStroke(a, stroke({ id: 'base-stroke' }))
    renameLayer(a, BASE_LAYER_ID, '내 이름', origin)
    const b = new Y.Doc()
    sync(a, b)
    const theirs = addLayer(b)!
    sync(a, b)
    undo.undo()
    const layers = readLayers(a)
    expect(layers.map((l) => l.id)).toEqual([BASE_LAYER_ID, theirs])
    expect(layers[0].name).toBe('레이어 1')
    expect(layerOf(readStrokes(a)[0], layers)).toBe(BASE_LAYER_ID)
  })

  test('지운 기본 레이어는 되돌리기로 돌아온다', () => {
    const doc = createPageDoc('2026-10-16')
    const origin = { local: true }
    const undo = createUndoManager(doc, origin)
    const top = addLayer(doc)!
    undo.stopCapturing()
    deleteLayer(doc, BASE_LAYER_ID, origin)
    expect(readLayers(doc).map((l) => l.id)).toEqual([top])
    undo.undo()
    expect(readLayers(doc).map((l) => l.id)).toEqual([BASE_LAYER_ID, top])
  })
})

describe('레이어를 스티커처럼 잡기', () => {
  test('기본 레이어가 아닌 레이어의 획을 잡으면 그 레이어의 획이 모두 잡힌다', () => {
    const doc = createPageDoc('2026-10-16')
    const sticker = addLayer(doc)!
    const strokes = [
      stroke({ id: 'a', layer: sticker }),
      stroke({ id: 'b', layer: sticker }),
      stroke({ id: 'base-1' }),
      stroke({ id: 'base-2' }),
    ]
    const layers = readLayers(doc)
    expect(grabIds(['a'], strokes, layers).sort()).toEqual(['a', 'b'])
    // 기본 레이어(페이지)의 획은 하나씩
    expect(grabIds(['base-1'], strokes, layers)).toEqual(['base-1'])
    // 사각형으로 섞어 고르면 스티커 레이어는 통째로, 기본 레이어는 고른 것만
    expect(grabIds(['b', 'base-2'], strokes, layers).sort()).toEqual(['a', 'b', 'base-2'])
  })
})

describe('레이어 강조', () => {
  test('강조한 레이어만 그대로 두고 다른 레이어는 흐리게 그린다', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    setLayerOpacity(doc, BASE_LAYER_ID, 0.8)
    const plan = highlightPlan(layerPlan([stroke({ id: 'a' }), stroke({ id: 'b', layer: top })], readLayers(doc)), top)
    expect(plan.map((p) => [p.layer.id, p.layer.opacity])).toEqual([
      [BASE_LAYER_ID, 0.2],
      [top, 1],
    ])
  })

  test('강조할 레이어가 없으면 그대로', () => {
    const doc = createPageDoc('2026-10-16')
    const plan = layerPlan([stroke({ id: 'a' })], readLayers(doc))
    expect(highlightPlan(plan, null)).toBe(plan)
  })
})
