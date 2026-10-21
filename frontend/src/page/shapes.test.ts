// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { curvePoints, densify, shapePoints, SHAPE_STEP } from './shapes'
import type { Point } from './geometry'

function pts(flat: number[]): Point[] {
  const out: Point[] = []
  for (let i = 0; i < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1] })
  return out
}
function bounds(ps: Point[]) {
  const xs = ps.map((p) => p.x)
  const ys = ps.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}
function maxGap(ps: Point[]) {
  let g = 0
  for (let i = 1; i < ps.length; i++) g = Math.max(g, Math.hypot(ps[i].x - ps[i - 1].x, ps[i].y - ps[i - 1].y))
  return g
}

describe('도형 점', () => {
  test('densify: 꼭짓점을 지나며 같은 간격으로 잇고 필압은 하나', () => {
    const flat = densify([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.5)
    const ps = pts(flat)
    expect(ps[0]).toEqual({ x: 0, y: 0 })
    expect(ps).toContainEqual({ x: 10, y: 0 })
    expect(ps.at(-1)).toEqual({ x: 10, y: 10 })
    expect(maxGap(ps)).toBeLessThanOrEqual(SHAPE_STEP + 0.15)
    for (let i = 2; i < flat.length; i += 3) expect(flat[i]).toBe(0.5)
  })

  test('사각형: 끈 범위를 감싸고 시작점으로 닫힌다', () => {
    const ps = pts(shapePoints('rect', { x: 100, y: 50 }, { x: 20, y: 150 }, false))
    expect(bounds(ps)).toEqual({ minX: 20, maxX: 100, minY: 50, maxY: 150 })
    expect(ps.at(-1)).toEqual(ps[0])
  })

  test('사각형 + Shift: 정사각형(긴 쪽에 맞춘다, 끈 방향 유지)', () => {
    const ps = pts(shapePoints('rect', { x: 0, y: 0 }, { x: -40, y: 100 }, true))
    expect(bounds(ps)).toEqual({ minX: -100, maxX: 0, minY: 0, maxY: 100 })
  })

  test('타원: 끈 범위에 꼭 맞고 닫힌다', () => {
    const ps = pts(shapePoints('ellipse', { x: 0, y: 0 }, { x: 200, y: 100 }, false))
    const b = bounds(ps)
    expect(b.minX).toBeCloseTo(0, 0)
    expect(b.maxX).toBeCloseTo(200, 0)
    expect(b.minY).toBeCloseTo(0, 0)
    expect(b.maxY).toBeCloseTo(100, 0)
    expect(ps.at(-1)).toEqual(ps[0])
    expect(maxGap(ps)).toBeLessThanOrEqual(SHAPE_STEP + 0.3)
  })

  test('타원 + Shift: 원', () => {
    const b = bounds(pts(shapePoints('ellipse', { x: 0, y: 0 }, { x: 200, y: 80 }, true)))
    expect(b.maxX - b.minX).toBeCloseTo(b.maxY - b.minY, 0)
  })

  test('삼각형: 위 가운데 꼭짓점과 아래 두 꼭짓점, 닫힌다', () => {
    const ps = pts(shapePoints('triangle', { x: 0, y: 0 }, { x: 100, y: 80 }, false))
    expect(ps).toContainEqual({ x: 50, y: 0 })
    expect(ps).toContainEqual({ x: 0, y: 80 })
    expect(ps).toContainEqual({ x: 100, y: 80 })
    expect(ps.at(-1)).toEqual(ps[0])
  })

  test('화살표: 끝점에서 두 날개가 뒤로 벌어진다', () => {
    const ps = pts(shapePoints('arrow', { x: 0, y: 100 }, { x: 200, y: 100 }, false))
    expect(ps[0]).toEqual({ x: 0, y: 100 })
    expect(ps).toContainEqual({ x: 200, y: 100 })
    // 날개 끝은 끝점보다 뒤(왼쪽)에, 위아래로 하나씩
    const wings = ps.filter((p) => p.x < 200 && Math.abs(p.y - 100) > 5)
    expect(wings.some((p) => p.y < 100)).toBe(true)
    expect(wings.some((p) => p.y > 100)).toBe(true)
    expect(Math.max(...ps.map((p) => p.x))).toBe(200)
  })

  test('화살표 + Shift: 45도 단위로 맞춘다', () => {
    const ps = pts(shapePoints('arrow', { x: 0, y: 0 }, { x: 100, y: 90 }, true))
    const tip = ps.find((p) => Math.abs(p.x - p.y) < 0.2 && p.x > 90)
    expect(tip).toBeDefined()
  })

  test('n점 곡선(열림): 찍은 점을 모두 지나고 처음과 끝이 찍은 점', () => {
    const controls = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }]
    const ps = pts(curvePoints(controls, false))
    expect(ps[0]).toEqual({ x: 0, y: 0 })
    expect(ps.at(-1)).toEqual({ x: 200, y: 0 })
    expect(ps).toContainEqual({ x: 100, y: 100 })
    expect(maxGap(ps)).toBeLessThanOrEqual(SHAPE_STEP + 0.5)
  })

  test('n점 곡선(닫힘): 첫 점으로 돌아와 닫힌다', () => {
    const controls = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]
    const ps = pts(curvePoints(controls, true))
    expect(ps[0]).toEqual({ x: 0, y: 0 })
    expect(ps.at(-1)).toEqual({ x: 0, y: 0 })
    expect(ps).toContainEqual({ x: 100, y: 0 })
    expect(ps).toContainEqual({ x: 50, y: 80 })
  })

  test('점 하나면 점 하나', () => {
    expect(curvePoints([{ x: 3, y: 4 }], false)).toEqual([3, 4, 0.5])
  })
})
