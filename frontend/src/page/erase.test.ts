// @vitest-environment node
import * as Y from 'yjs'
import { describe, expect, test } from 'vitest'
import { addStroke, createPageDoc, eraseStrokes, readStrokes, strokesMap, type Stroke } from './doc'
import { cutStroke, erasesWhole, filterStrokes, matchesFilter, polylineLength } from './erase'
import { createUndoManager } from './undo'
import { compareStrokes } from './render'

function line(id: string, x1: number, x2: number, y = 100, extra: Partial<Stroke> = {}): Stroke {
  const points: number[] = []
  // 10px 간격 점, 필압은 x에 따라 0.2~0.8
  for (let x = x1; x <= x2; x += 10) points.push(x, y, Math.round((0.2 + ((x - x1) / (x2 - x1)) * 0.6) * 100) / 100)
  return { id, tool: 'pen', color: '#2A47B0', width: 4, points, author: '나', createdAt: 5, ...extra }
}

const xs = (piece: number[]) => piece.filter((_, i) => i % 3 === 0)

describe('범위 지우개 자르기', () => {
  test('가운데를 지나가면 두 조각이 남고, 잘린 끝은 지우개 원 경계(반지름 + 굵기/2)에 놓인다', () => {
    const s = line('a', 100, 300)
    const pieces = cutStroke(s, [{ x: 200, y: 80 }, { x: 200, y: 120 }], 10)!
    expect(pieces).toHaveLength(2)
    // reach = 10 + 2 = 12
    expect(xs(pieces[0]).at(-1)).toBeCloseTo(188, 0)
    expect(xs(pieces[1])[0]).toBeCloseTo(212, 0)
    expect(xs(pieces[0])[0]).toBe(100)
    expect(xs(pieces[1]).at(-1)).toBe(300)
    // 필압은 원래 점 그대로, 잘린 끝은 보간
    expect(pieces[0][2]).toBe(0.2)
    expect(pieces[0].at(-1)).toBeCloseTo(0.2 + (88 / 200) * 0.6, 2)
  })

  test('끝을 지우면 한 조각만 남는다', () => {
    const pieces = cutStroke(line('a', 100, 300), [{ x: 300, y: 100 }], 10)!
    expect(pieces).toHaveLength(1)
    expect(xs(pieces[0])[0]).toBe(100)
    expect(xs(pieces[0]).at(-1)).toBeCloseTo(288, 0)
  })

  test('여러 번 지나가면 그만큼 조각이 생긴다', () => {
    const path = [
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 250, y: 150 },
      { x: 250, y: 50 },
    ]
    const pieces = cutStroke(line('a', 100, 300), path, 5)!
    expect(pieces).toHaveLength(3)
  })

  test('닿지 않으면 null, 다 덮으면 빈 조각', () => {
    expect(cutStroke(line('a', 100, 300), [{ x: 200, y: 200 }], 10)).toBeNull()
    expect(cutStroke(line('a', 100, 120), [{ x: 110, y: 100 }], 30)).toEqual([])
  })

  test('굵기 수준보다 짧은 조각은 버린다', () => {
    // 왼쪽 끝 1px만 남는 자리
    const pieces = cutStroke(line('a', 100, 300, 100, { width: 10 }), [{ x: 118, y: 100 }, { x: 200, y: 100 }], 12)!
    expect(pieces).toHaveLength(1)
    expect(polylineLength(pieces[0])).toBeGreaterThan(5)
  })

  test('점 사이가 먼 긴 직선의 가운데를 지나가도 자른다', () => {
    const s: Stroke = { ...line('a', 0, 10), points: [100, 100, 0.5, 500, 100, 0.5] }
    const pieces = cutStroke(s, [{ x: 300, y: 100 }], 10)!
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toEqual([100, 100, 0.5, 288, 100, 0.5])
  })

  test('닫힌 테두리(처음 점 = 끝 점)는 이음매에서 갈린 두 조각을 잇는다', () => {
    const square: Stroke = { ...line('a', 0, 10), points: [100, 100, 0.5, 200, 100, 0.5, 200, 200, 0.5, 100, 200, 0.5, 100, 100, 0.5] }
    const pieces = cutStroke(square, [{ x: 200, y: 150 }], 5)!
    expect(pieces).toHaveLength(1)
    // 오른쪽 변 아래에서 시작해 이음매(100,100)를 지나 오른쪽 변 위에서 끝난다
    expect(pieces[0].slice(0, 2)).toEqual([200, 157])
    expect(pieces[0].slice(-3, -1)).toEqual([200, 143])
  })

  test('채움 도형과 점 하나짜리 획은 자르지 않고 통째로 지운다', () => {
    expect(erasesWhole({ ...line('a', 100, 300), fill: 0.6 })).toBe(true)
    expect(erasesWhole({ ...line('a', 100, 300), points: [5, 5, 0.5] })).toBe(true)
    expect(erasesWhole(line('a', 100, 300))).toBe(false)
  })
})

describe('지울 대상 거르기', () => {
  const pen = line('p', 0, 100)
  const hl = line('h', 0, 100, 100, { tool: 'highlighter' })
  const paint = line('c', 0, 100, 100, { tool: 'paint' })
  const shape = line('s', 0, 100, 100, { steady: true, fill: 0.3 })
  test('모두·펜만·형광펜만. 도형은 펜, 채색 붓은 모두에만 든다', () => {
    const all = [pen, hl, paint, shape]
    expect(filterStrokes(all, 'all')).toHaveLength(4)
    expect(filterStrokes(all, 'pen').map((s) => s.id)).toEqual(['p', 's'])
    expect(filterStrokes(all, 'highlighter').map((s) => s.id)).toEqual(['h'])
    expect(matchesFilter(paint, 'pen')).toBe(false)
  })
})

describe('자른 결과 쓰기', () => {
  function seeded(binary: boolean) {
    const doc = createPageDoc('2026-10-29')
    addStroke(doc, { ...line('aaaaaaaaaaaaaaaa', 100, 300), layer: 'L2', brush: 'pencil' }, undefined, binary)
    addStroke(doc, line('zzzzzzzzzzzzzzzz', 100, 300, 200))
    return doc
  }

  test('조각은 같은 도구·색·굵기·레이어·작성자·시각·점 형식으로 생기고 원래 획은 사라진다(이진 점)', () => {
    const doc = seeded(true)
    const s = readStrokes(doc).find((x) => x.id.startsWith('a'))!
    const pieces = cutStroke(s, [{ x: 200, y: 100 }], 10)!
    const ids = eraseStrokes(doc, [], [{ id: s.id, pieces }], 'me')
    expect(ids).toHaveLength(2)
    expect(strokesMap(doc).has(s.id)).toBe(false)
    for (const id of ids) {
      const m = strokesMap(doc).get(id)!
      expect(m.get('pts')).toBeInstanceOf(Uint8Array)
      expect(m.has('points')).toBe(false)
      const r = readStrokes(doc).find((x) => x.id === id)!
      expect(r).toMatchObject({ tool: 'pen', color: '#2A47B0', width: 4, layer: 'L2', brush: 'pencil', author: '나', createdAt: 5 })
      // 순서: 원래 획 자리(다른 획보다 앞)
      expect(compareStrokes(r, readStrokes(doc).find((x) => x.id.startsWith('z'))!)).toBeLessThan(0)
    }
    expect(readStrokes(doc).find((x) => x.id === ids[0])!.points).toEqual(pieces[0])
  })

  test('한 번 문지른 것은 되돌리기 한 단계, 다른 화면에는 한 번의 갱신으로 간다', () => {
    const doc = seeded(false)
    const origin = { local: true }
    const um = createUndoManager(doc, origin)
    const before = readStrokes(doc).map((x) => x.id).sort()
    const s = readStrokes(doc).find((x) => x.id.startsWith('a'))!
    let updates = 0
    doc.on('update', () => updates++)
    eraseStrokes(doc, ['zzzzzzzzzzzzzzzz'], [{ id: s.id, pieces: cutStroke(s, [{ x: 200, y: 100 }], 10)! }], origin)
    expect(updates).toBe(1)
    expect(readStrokes(doc)).toHaveLength(2)
    um.undo()
    expect(readStrokes(doc).map((x) => x.id).sort()).toEqual(before)
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    expect(readStrokes(other)).toHaveLength(2)
  })
})
