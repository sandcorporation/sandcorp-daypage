// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { decodePoints, encodePoints, POINT_FORMAT } from './pointCodec'
import vectors from './pointCodec.vectors.json'

describe('획 점 바이너리', () => {
  test('좌표(0.1 단위)와 필압(0.01 단위)을 그대로 되살린다', () => {
    const points = [0, 0, 0.5, 123.4, 567.8, 0.73, 1599.9, 2399.9, 1, 1599.8, 2399.7, 0.15]
    expect(decodePoints(encodePoints(points))).toEqual(points)
  })

  test('음수 좌표와 큰 이동(장 밖으로 옮긴 획)도 그대로', () => {
    const points = [-40.5, -12.3, 0.5, 3200.1, 4800.2, 0.6, -0.1, 0.1, 0]
    expect(decodePoints(encodePoints(points))).toEqual(points)
  })

  test('형식 번호로 시작하고, 가까운 점은 점마다 3바이트면 된다', () => {
    const points: number[] = []
    for (let i = 0; i < 100; i++) points.push(100 + i * 0.8, 200 + i * 0.3, 0.5)
    const bytes = encodePoints(points)
    expect(bytes[0]).toBe(POINT_FORMAT)
    expect(bytes.length).toBeLessThanOrEqual(1 + 6 + 99 * 3)
  })

  test('빈 획과 점 하나', () => {
    expect(decodePoints(encodePoints([]))).toEqual([])
    expect(decodePoints(encodePoints([5, 6, 0.4]))).toEqual([5, 6, 0.4])
  })

  test('모르는 형식이면 빈 획으로 읽는다(새 형식을 모르는 옛 코드가 깨지지 않게)', () => {
    expect(decodePoints(new Uint8Array([99, 1, 2, 3]))).toEqual([])
  })
})

// 백엔드(backend/daypage/points.py)도 같은 벡터를 읽어 같은 바이트를 내는지 본다(봉인 때 서버가 점을 다시 쓴다).
describe('공유 시험 벡터', () => {
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  test.each(vectors)('$name', ({ points, bytes }) => {
    expect(hex(encodePoints(points))).toBe(bytes)
  })
})
