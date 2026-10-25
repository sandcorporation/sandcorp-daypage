// @vitest-environment node
import { smoothPoints, smoothTailFrom } from './inkSmooth'

const scale = 0.6
const pixel = 1 / scale
/** 화면 정수 픽셀로 자른 장 좌표(아이패드 Safari가 주는 모양) */
const snap = (v: number) => Math.round(v * scale) / scale

/** 비스듬한 곧은 선을 촘촘히 지나는 점(참값, 잘린 값) */
function slantedLine(n = 200) {
  const truth: number[] = []
  const raw: number[] = []
  for (let i = 0; i <= n; i++) {
    const x = 100 + 0.13 * i * 2.5
    const y = 100 + i * 2.5
    truth.push(x, y, 0.5 + (i % 7) / 20)
    raw.push(snap(x), snap(y), 0.5 + (i % 7) / 20)
  }
  return { truth, raw }
}

/** 점에서 참 선(x = 100 + 0.13·(y − 100))까지 수직 거리의 제곱 평균(창이 줄어드는 양 끝 열다섯 점은 뺀다) */
function wobble(points: number[]) {
  let sum = 0
  let n = 0
  for (let i = 15 * 3; i < points.length - 15 * 3; i += 3) {
    const d = (points[i] - (100 + 0.13 * (points[i + 1] - 100))) / Math.hypot(1, 0.13)
    sum += d * d
    n++
  }
  return Math.sqrt(sum / n)
}

test('정수 픽셀로 잘린 비스듬한 선의 계단을 편다(참 선에 훨씬 가까워진다)', () => {
  const { raw } = slantedLine()
  const before = wobble(raw)
  const after = wobble(smoothPoints(raw, pixel))
  expect(before).toBeGreaterThan(pixel * 0.2)
  expect(after).toBeLessThan(before / 3)
})

test('점은 원래 자리에서 반 픽셀보다 멀리 가지 않고, 첫·끝 점과 필압은 그대로다', () => {
  const { raw } = slantedLine(60)
  const out = smoothPoints(raw, pixel)
  for (let i = 0; i < raw.length; i += 3) {
    expect(Math.abs(out[i] - raw[i])).toBeLessThanOrEqual(pixel / 2 + 1e-9)
    expect(Math.abs(out[i + 1] - raw[i + 1])).toBeLessThanOrEqual(pixel / 2 + 1e-9)
    expect(out[i + 2]).toBe(raw[i + 2])
  }
  expect(out.slice(0, 3)).toEqual(raw.slice(0, 3))
  expect(out.slice(-3)).toEqual(raw.slice(-3))
})

test('꺾인 모서리(ㄱ)는 반 픽셀 넘게 둥글어지지 않는다', () => {
  const raw: number[] = []
  for (let i = 0; i <= 30; i++) raw.push(snap(100 + i * 2), snap(100), 0.7)
  for (let i = 1; i <= 30; i++) raw.push(snap(160), snap(100 + i * 2), 0.7)
  const out = smoothPoints(raw, pixel)
  const corner = 30 * 3
  expect(Math.hypot(out[corner] - raw[corner], out[corner + 1] - raw[corner + 1])).toBeLessThanOrEqual(pixel / Math.SQRT2 + 1e-9)
})

test('점이 둘뿐이면 그대로, 긋는 동안은 끝부분만 다시 고른다', () => {
  expect(smoothPoints([1, 2, 0.5, 3, 4, 0.5], pixel)).toEqual([1, 2, 0.5, 3, 4, 0.5])
  const { raw } = slantedLine(200)
  const from = smoothTailFrom(raw, pixel)
  expect(from).toBeGreaterThan(100)
  expect(from).toBeLessThan(200)
})
