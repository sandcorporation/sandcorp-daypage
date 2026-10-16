import * as Y from 'yjs'
import { addStroke, createPageDoc, readStrokes, transformStrokes, type Stroke } from './doc'
import {
  apply,
  handleAt,
  keepInPage,
  matrixScale,
  rotateAbout,
  rotationAngle,
  scaleAbout,
  scaleFactor,
  translate,
  transformedCorners,
} from './transform'
import { createUndoManager } from './undo'

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5))

function stroke(partial: Partial<Stroke>): Stroke {
  return { id: 's', tool: 'pen', color: '#000000', width: 6, points: [100, 100, 0.5, 200, 100, 0.5], author: 'me', createdAt: 0, ...partial }
}

describe('행렬', () => {
  test('기준점을 두고 키우면 기준점은 그대로, 나머지는 멀어진다', () => {
    const m = scaleAbout(100, 100, 2)
    close(apply(m, 100, 100), [100, 100])
    close(apply(m, 150, 120), [200, 140])
    expect(matrixScale(m)).toBeCloseTo(2)
  })

  test('가운데를 두고 90도 돌린다', () => {
    const m = rotateAbout(0, 0, Math.PI / 2)
    close(apply(m, 10, 0), [0, 10])
    expect(matrixScale(m)).toBeCloseTo(1)
  })

  test('옮기기', () => {
    close(apply(translate(5, -3), 1, 1), [6, -2])
  })

  test('상자의 네 모서리를 변환한다(회전한 선택 상자를 그릴 때)', () => {
    const pts = transformedCorners({ x: 0, y: 0, width: 10, height: 10 }, rotateAbout(5, 5, Math.PI))
    close(pts.flat(), [10, 10, 0, 10, 0, 0, 10, 0])
  })
})

describe('손잡이', () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 }

  test('모서리와 위쪽 회전 손잡이를 찾는다', () => {
    expect(handleAt(rect, { x: 102, y: 98 }, 10, 40)).toBe('nw')
    expect(handleAt(rect, { x: 300, y: 200 }, 10, 40)).toBe('se')
    expect(handleAt(rect, { x: 200, y: 60 }, 10, 40)).toBe('rotate')
    expect(handleAt(rect, { x: 200, y: 150 }, 10, 40)).toBeNull()
  })

  test('끈 거리만큼 비율이 정해지고 너무 작거나 크게는 안 된다', () => {
    const anchor = { x: 0, y: 0 }
    const corner = { x: 100, y: 100 }
    expect(scaleFactor(anchor, corner, { x: 200, y: 200 })).toBeCloseTo(2)
    expect(scaleFactor(anchor, corner, { x: 50, y: 50 })).toBeCloseTo(0.5)
    expect(scaleFactor(anchor, corner, { x: 0, y: 0 })).toBe(0.1)
    expect(scaleFactor(anchor, corner, { x: 5000, y: 5000 })).toBe(8)
    // 반대쪽으로 넘어가도 뒤집히지 않는다
    expect(scaleFactor(anchor, corner, { x: -100, y: -100 })).toBe(0.1)
  })

  test('회전각은 끈 만큼이고, 0·90·180·270도 근처에서는 딱 맞춘다', () => {
    const c = { x: 0, y: 0 }
    expect(rotationAngle(c, { x: 0, y: -10 }, { x: 10, y: 0 })).toBeCloseTo(Math.PI / 2)
    expect(rotationAngle(c, { x: 0, y: -10 }, { x: 10, y: -10 })).toBeCloseTo(Math.PI / 4)
    // 2도 남짓 어긋나도 0도로
    expect(rotationAngle(c, { x: 0, y: -100 }, { x: 4, y: -100 })).toBe(0)
  })

  test('페이지 밖으로 나간 묶음은 안으로 밀어 넣는다', () => {
    expect(keepInPage({ x: -20, y: 10, width: 100, height: 100 })).toEqual({ dx: 20, dy: 0 })
    expect(keepInPage({ x: 1550, y: 2350, width: 100, height: 100 })).toEqual({ dx: -50, dy: -50 })
    expect(keepInPage({ x: 10, y: 10, width: 100, height: 100 })).toEqual({ dx: 0, dy: 0 })
  })
})

describe('획에 반영', () => {
  test('키우면 좌표와 굵기가 함께 커지고 필압은 그대로다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'a', points: [100, 100, 0.3, 200, 100, 0.8] }))
    transformStrokes(doc, ['a'], scaleAbout(100, 100, 2))
    const [s] = readStrokes(doc)
    close(s.points, [100, 100, 0.3, 300, 100, 0.8])
    expect(s.width).toBeCloseTo(12)
  })

  test('돌려도 굵기는 그대로이고, 되돌리기로 원래대로 돌아온다', () => {
    const doc = createPageDoc('2026-10-16')
    const origin = { local: true }
    const undo = createUndoManager(doc, origin)
    addStroke(doc, stroke({ id: 'a' }))
    undo.stopCapturing()
    transformStrokes(doc, ['a'], rotateAbout(150, 100, Math.PI / 2), origin)
    const [s] = readStrokes(doc)
    close(s.points, [150, 50, 0.5, 150, 150, 0.5])
    expect(s.width).toBe(6)
    undo.undo()
    close(readStrokes(doc)[0].points, [100, 100, 0.5, 200, 100, 0.5])
  })

  test('다른 문서에도 같게 반영된다', () => {
    const a = createPageDoc('2026-10-16')
    addStroke(a, stroke({ id: 'a' }))
    transformStrokes(a, ['a'], translate(10, 20))
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    close(readStrokes(b)[0].points, [110, 120, 0.5, 210, 120, 0.5])
  })
})
