// @vitest-environment node
import { getStroke } from 'perfect-freehand'
import { describe, expect, test } from 'vitest'
import type { Stroke } from './doc'
import type { Brush } from './tools'
import { cutDrawnStroke, cutStroke } from './erase'
import type { Point } from './geometry'
import { strokeOutline } from './render'
import { decodePoints, encodePoints } from './pointCodec'

/** 손가락으로 빠르게 그은 Z: 점이 120px 가까이 듬성하고 필압이 없다(0.5) */
function sparseZ(extra: Partial<Stroke> = {}): Stroke {
  const corners: Point[] = [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 100, y: 500 },
    { x: 700, y: 500 },
  ]
  const points: number[] = []
  for (let c = 0; c + 1 < corners.length; c++) {
    const a = corners[c]
    const b = corners[c + 1]
    const n = 5
    for (let k = c === 0 ? 0 : 1; k <= n; k++) points.push(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, 0.5)
  }
  return { id: 'z', tool: 'pen', color: '#222', width: 3, points, author: '나', createdAt: 1, ...extra }
}

function distToSegment(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** 점에서 닫힌 윤곽(다각형 변)까지 거리 */
function distToOutline(p: number[], outline: number[][]): number {
  let best = Infinity
  for (let i = 0; i < outline.length; i++) best = Math.min(best, distToSegment(p, outline[i], outline[(i + 1) % outline.length]))
  return best
}

function distToPath(p: number[], path: Point[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < path.length; i++) best = Math.min(best, distToSegment(p, [path[i].x, path[i].y], [path[i + 1].x, path[i + 1].y]))
  return best
}

/** 저장(바이너리 점 왕복)까지 거친 조각 획 */
function stored(s: Stroke, points: number[]): Stroke {
  return { ...s, points: decodePoints(encodePoints(points)) }
}

/**
 * 지운 범위(지우개 경로에서 reach + 굵기 안) 밖에서, 자르기 전 윤곽과 남은 조각들의 윤곽이 서로 얼마나 떨어졌는지(양방향 최대).
 */
function outlineDrift(s: Stroke, pieces: number[][], path: Point[], radius: number): number {
  const keepOut = radius + s.width / 2 + s.width * 2
  const before = strokeOutline(s)
  const after = pieces.map((p) => strokeOutline(stored(s, p)))
  let worst = 0
  for (const o of after)
    for (const q of o) if (distToPath(q, path) > keepOut) worst = Math.max(worst, distToOutline(q, before))
  for (const q of before)
    if (distToPath(q, path) > keepOut) worst = Math.max(worst, Math.min(...after.map((o) => distToOutline(q, o))))
  return worst
}

const eraser: Point[] = [
  { x: 400, y: 85 },
  { x: 400, y: 115 },
]

describe('지우개로 자른 획은 남은 부분이 보이던 자리에 남는다 (#263)', () => {
  test('원래 점 그대로 자르면(옛 방식) 듬성한 Z의 남은 조각이 다른 자리에 그려진다', () => {
    const s = sparseZ()
    const pieces = cutStroke(s, eraser, 6)!
    expect(pieces).toHaveLength(2)
    expect(outlineDrift(s, pieces, eraser, 6)).toBeGreaterThan(4)
  })

  test.each<Brush | undefined>([undefined, 'fountain', 'brushpen', 'pencil', 'crayon'])('펜 %s: 듬성한 Z를 가운데 조금 자르면 남은 조각의 윤곽이 2px 안에 남는다', (brush) => {
    const s = sparseZ(brush ? { brush } : {})
    const pieces = cutDrawnStroke(s, eraser, 6)!
    expect(pieces).toHaveLength(2)
    expect(outlineDrift(s, pieces, eraser, 6)).toBeLessThan(2)
  })

  test('필압이 있는 획도, 필압을 끈 획도 남은 조각의 윤곽이 2px 안에 남는다', () => {
    const pressured = sparseZ()
    pressured.points = pressured.points.map((v, i) => (i % 3 === 2 ? 0.2 + ((i / 3) % 5) * 0.15 : v))
    for (const s of [pressured, sparseZ({ steady: true })]) {
      const pieces = cutDrawnStroke(s, eraser, 6)!
      expect(pieces).toHaveLength(2)
      expect(outlineDrift(s, pieces, eraser, 6)).toBeLessThan(2)
    }
  })

  test('자른 조각을 또 잘라도 남은 부분은 그대로다', () => {
    const s = sparseZ()
    const [first, second] = cutDrawnStroke(s, eraser, 6)!
    const piece = stored(s, second)
    const again: Point[] = [
      { x: 380, y: 280 },
      { x: 420, y: 320 },
    ]
    const pieces = cutDrawnStroke(piece, again, 6)!
    expect(pieces).toHaveLength(2)
    expect(outlineDrift(piece, pieces, again, 6)).toBeLessThan(2)
    expect(first.length).toBeGreaterThan(3)
  })

  test('형광펜·채색은 점을 그대로 이어 그리므로 원래 점 그대로 자른다', () => {
    for (const tool of ['highlighter', 'paint'] as const) {
      const s = sparseZ({ tool })
      expect(cutDrawnStroke(s, eraser, 6)).toEqual(cutStroke(s, eraser, 6))
    }
  })

  test('지우개가 닿지 않으면 null, 통째로 지나가면 빈 배열', () => {
    const s = sparseZ()
    expect(cutDrawnStroke(s, [{ x: 400, y: 200 }], 2)).toBeNull()
    expect(cutDrawnStroke(s, [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }, { x: 400, y: 300 }], 400)).toEqual([])
  })
})

describe('자르지 않은 획 그리기는 그대로다', () => {
  test('볼펜 윤곽은 펜 종류가 생기기 전 설정의 perfect-freehand 결과와 같다', () => {
    const s = sparseZ()
    const triples: number[][] = []
    for (let i = 0; i < s.points.length; i += 3) triples.push(s.points.slice(i, i + 3))
    const expected = getStroke(triples, { size: 3, thinning: 0.55, smoothing: 0.5, streamline: 0.45, simulatePressure: true, last: true })
    expect(strokeOutline(s)).toEqual(expected)
  })
})
