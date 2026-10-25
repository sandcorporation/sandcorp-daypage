// @vitest-environment node
import type { Stroke } from './doc'
import { strokeBounds } from './hit'
import { fromPixelRect, overlaps, paintBounds, PaintedStrokes, toPixelRect, transformRect, union } from './inkScene'

function stroke(id: string, points: number[], over: Partial<Stroke> = {}): Stroke {
  return { id, tool: 'pen', color: '#000', width: 4, points, author: '나', createdAt: 1, ...over }
}

describe('획이 칠하는 범위', () => {
  test('펜은 필압이 세면 굵기의 반보다 넓게 칠하니 그만큼 넓힌다(붓펜이 가장 넓다)', () => {
    const pts = [100, 100, 0.5, 200, 150, 0.5]
    const ball = paintBounds(stroke('a', pts))
    const brush = paintBounds(stroke('b', pts, { brush: 'brushpen' }))
    expect(ball.x).toBeLessThan(strokeBounds(stroke('a', pts)).x)
    // 볼펜: 점에서 굵기 × 0.9 + 여유 2
    expect(ball.x).toBeCloseTo(100 - 4 * 0.9 - 2)
    expect(brush.x).toBeLessThan(ball.x)
  })

  test('형광펜·채색은 둥근 끝 선이라 굵기의 반, 부드러운 채색은 번지는 만큼 더', () => {
    const pts = [100, 100, 0.5, 200, 100, 0.5]
    expect(paintBounds(stroke('h', pts, { tool: 'highlighter', width: 16 })).x).toBeCloseTo(100 - 8 - 2)
    const soft = paintBounds(stroke('p', pts, { tool: 'paint', width: 40, soft: true }))
    expect(soft.x).toBeLessThan(100 - 20 - 2)
  })
})

describe('사각형 계산', () => {
  test('변환한 사각형을 감싸는 사각형(돌리면 넓어진다)', () => {
    expect(transformRect({ x: 0, y: 0, width: 10, height: 20 }, [1, 0, 0, 1, 5, 7])).toEqual({ x: 5, y: 7, width: 10, height: 20 })
    const turned = transformRect({ x: 0, y: 0, width: 10, height: 10 }, [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0])
    expect(turned.width).toBeCloseTo(10 * Math.SQRT2)
  })

  test('합치기·겹침', () => {
    expect(union(null, null)).toBeNull()
    expect(union({ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: -2, width: 1, height: 1 })).toEqual({ x: 0, y: -2, width: 6, height: 3 })
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 })).toBe(true)
    expect(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false)
  })

  test('픽셀 사각형은 경계에 맞춰 넓히고 1px 더 두며, 캔버스 안으로 자른다', () => {
    expect(toPixelRect({ x: 10.2, y: 10.7, width: 5, height: 5 }, 2, 1000, 1000)).toEqual({ x: 19, y: 20, width: 13, height: 13 })
    expect(toPixelRect({ x: -50, y: -50, width: 60, height: 60 }, 1, 100, 100)).toEqual({ x: 0, y: 0, width: 11, height: 11 })
    expect(toPixelRect({ x: 500, y: 500, width: 5, height: 5 }, 1, 100, 100)).toBeNull()
    expect(fromPixelRect({ x: 20, y: 40, width: 10, height: 10 }, 2)).toEqual({ x: 10, y: 20, width: 5, height: 5 })
  })
})

describe('그려 둔 획 목록', () => {
  test('지운 획도 지우기 전까지 범위를 알려 주고, 사각형에 걸치는 획만 고른다', () => {
    const scene = new PaintedStrokes()
    scene.reset([stroke('a', [10, 10, 0.5, 20, 20, 0.5]), stroke('b', [500, 500, 0.5, 520, 520, 0.5])])
    expect(scene.within({ x: 0, y: 0, width: 50, height: 50 }).map((s) => s.id)).toEqual(['a'])
    const before = scene.boundsOf(['a'])
    expect(before).not.toBeNull()
    scene.delete('a')
    expect(scene.boundsOf(['a'])).toBeNull()
    expect(scene.within({ x: 0, y: 0, width: 50, height: 50 })).toEqual([])
  })

  test('여러 획의 범위를 합치고, 변환을 주면 옮긴 자리로', () => {
    const scene = new PaintedStrokes()
    scene.reset([stroke('a', [10, 10, 0.5]), stroke('b', [100, 100, 0.5])])
    const both = scene.boundsOf(['a', 'b'])!
    const moved = scene.boundsOf(['a', 'b'], [1, 0, 0, 1, 1000, 0])!
    expect(moved.x).toBeCloseTo(both.x + 1000)
    expect(moved.width).toBeCloseTo(both.width)
  })
})
