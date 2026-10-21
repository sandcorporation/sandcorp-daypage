// @vitest-environment node
import * as Y from 'yjs'
import { addStroke, brushOf, createPageDoc, readStrokes, type Stroke } from './doc'
import { BRUSHES } from './tools'

function stroke(partial: Partial<Stroke>): Stroke {
  return {
    id: partial.id ?? 's',
    tool: 'pen',
    color: '#2A47B0',
    width: 6,
    points: [0, 0, 0.5, 10, 10, 0.5],
    author: 'me',
    createdAt: 0,
    ...partial,
  }
}

describe('펜 종류', () => {
  test('고른 펜 종류를 획에 저장하고 다른 문서에서도 같게 읽는다', () => {
    const a = createPageDoc('2026-10-16')
    addStroke(a, stroke({ id: 'b', brush: 'brushpen' }))
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const [read] = readStrokes(b)
    expect(read.brush).toBe('brushpen')
    expect(brushOf(read)).toBe('brushpen')
  })

  test('펜 종류가 없는 옛 획은 볼펜으로 본다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'old' }))
    const [read] = readStrokes(doc)
    expect(read.brush).toBeUndefined()
    expect(brushOf(read)).toBe('ballpoint')
  })

  test('모르는 펜 종류는 볼펜으로 본다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'x' }))
    doc.getMap<Y.Map<unknown>>('strokes').get('x')!.set('brush', 'laser')
    expect(brushOf(readStrokes(doc)[0])).toBe('ballpoint')
  })

  test('형광펜에는 펜 종류가 없다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'h', tool: 'highlighter', brush: 'brushpen' }))
    expect(readStrokes(doc)[0].brush).toBeUndefined()
  })

  test('볼펜은 저장하지 않아도 같은 모양이라 필드를 쓰지 않는다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'p', brush: 'ballpoint' }))
    expect(doc.getMap<Y.Map<unknown>>('strokes').get('p')!.has('brush')).toBe(false)
  })

  test('펜 종류 목록에 볼펜과 붓펜이 있다', () => {
    const ids = BRUSHES.map((b) => b.id)
    expect(ids).toContain('ballpoint')
    expect(ids).toContain('brushpen')
  })
})
