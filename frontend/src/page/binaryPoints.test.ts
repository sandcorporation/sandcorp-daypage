import * as Y from 'yjs'
import { describe, expect, test } from 'vitest'
import { addStroke, createPageDoc, moveStrokes, readStrokes, strokesMap, transformStrokes, type Stroke } from './doc'
import { scaleAbout } from './transform'

function stroke(id: string, points: number[]): Stroke {
  return { id, tool: 'pen', color: '#2A47B0', width: 6, points, author: 'me', createdAt: 1 }
}

// 색칠하듯 촘촘한 획(좌표 0.1, 필압 0.01 단위로 이미 반올림된 값)
const dense: number[] = []
for (let i = 0; i < 400; i++) dense.push(Math.round((100 + i * 0.7) * 10) / 10, Math.round((300 + Math.sin(i / 9) * 40) * 10) / 10, 0.62)

function copy(doc: Y.Doc): Y.Doc {
  const other = new Y.Doc()
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
  return other
}

describe('바이너리 점(pts)으로 쓴 획', () => {
  test('다른 화면에서도 같은 점으로 읽힌다', () => {
    const doc = createPageDoc('2026-10-17')
    addStroke(doc, stroke('b', dense), undefined, true)
    expect(strokesMap(doc).get('b')!.get('pts')).toBeInstanceOf(Uint8Array)
    expect(strokesMap(doc).get('b')!.has('points')).toBe(false)
    expect(readStrokes(copy(doc))[0].points).toEqual(dense)
  })

  test('숫자 배열로 쓸 때보다 문서가 훨씬 작다', () => {
    const a = createPageDoc('2026-10-17')
    const b = createPageDoc('2026-10-17')
    addStroke(a, stroke('s', dense), undefined, false)
    addStroke(b, stroke('s', dense), undefined, true)
    const sa = Y.encodeStateAsUpdate(a).length
    const sb = Y.encodeStateAsUpdate(b).length
    expect(sb).toBeLessThan(sa * 0.4)
  })

  test('옛 획(숫자 배열)과 한 장에 섞여도 둘 다 읽는다', () => {
    const doc = createPageDoc('2026-10-17')
    addStroke(doc, stroke('old', [1, 2, 0.5, 3, 4, 0.5]), undefined, false)
    addStroke(doc, stroke('new', dense), undefined, true)
    const byId = Object.fromEntries(readStrokes(copy(doc)).map((s) => [s.id, s.points]))
    expect(byId.old).toEqual([1, 2, 0.5, 3, 4, 0.5])
    expect(byId.new).toEqual(dense)
  })

  test('옮겨도 바이너리로 남고 좌표만 바뀐다', () => {
    const doc = createPageDoc('2026-10-17')
    addStroke(doc, stroke('b', [10, 20, 0.5, 30.5, 40.5, 0.7]), undefined, true)
    moveStrokes(doc, ['b'], 5, -2)
    const m = strokesMap(doc).get('b')!
    expect(m.get('pts')).toBeInstanceOf(Uint8Array)
    expect(readStrokes(doc)[0].points).toEqual([15, 18, 0.5, 35.5, 38.5, 0.7])
  })

  test('키워도 바이너리로 남고, 옛 획은 옛 형식으로 남는다', () => {
    const doc = createPageDoc('2026-10-17')
    addStroke(doc, stroke('b', [10, 10, 0.5, 20, 20, 0.5]), undefined, true)
    addStroke(doc, stroke('o', [10, 10, 0.5, 20, 20, 0.5]), undefined, false)
    transformStrokes(doc, ['b', 'o'], scaleAbout(10, 10, 2))
    expect(strokesMap(doc).get('b')!.get('pts')).toBeInstanceOf(Uint8Array)
    expect(strokesMap(doc).get('o')!.get('points')).toEqual([10, 10, 0.5, 30, 30, 0.5])
    expect(readStrokes(doc).find((s) => s.id === 'b')!.points).toEqual([10, 10, 0.5, 30, 30, 0.5])
  })

  test('1단계 배포: 기본은 아직 숫자 배열로 쓴다(새 형식을 모르는 화면이 남아 있을 수 있다)', () => {
    const doc = createPageDoc('2026-10-17')
    addStroke(doc, stroke('d', [1, 1, 0.5]))
    expect(strokesMap(doc).get('d')!.get('points')).toEqual([1, 1, 0.5])
  })
})
