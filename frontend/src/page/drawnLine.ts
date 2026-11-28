import { getStrokePoints } from 'perfect-freehand'
import type { Stroke } from './doc'
import { outlineOptions, toTriples } from './render'

/*
 * 펜 획이 화면에 그려지는 중심선. perfect-freehand는 점을 streamline으로 앞 점에 끌리게 따라가고(듬성한 획일수록
 * 꺾인 점에 못 닿는다), 필압이 없으면 속도로 굵기를 지어낸다. 그래서 저장된 점을 그대로 자르면 조각은 앞 문맥이
 * 달라져 다른 자리·굵기로 그려진다(#263). 자를 때는 그려진 중심선과 그 자리의 굵기(필압)를 자르고,
 * 그 조각이 같은 선으로 그려지는 점을 거꾸로 구해 저장한다. 문서 획 필드는 그대로다.
 */

/** perfect-freehand 상수(getStrokePoints·simulatePressure·getStrokeOutlinePoints와 같은 값) */
const MIN_STREAMLINE_T = 0.15
const STREAMLINE_T_RANGE = 0.85
const RATE_OF_PRESSURE_CHANGE = 0.275
const END_NOISE_THRESHOLD = 3

const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100

function simulatePressure(prev: number, distance: number, size: number): number {
  const sp = Math.min(1, distance / size)
  const rp = Math.min(1, 1 - sp)
  return Math.min(1, prev + (rp - prev) * (sp * RATE_OF_PRESSURE_CHANGE))
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1]

/**
 * 펜 획이 그려지는 중심선: 평평한 [x, y, 필압] 배열. 필압은 외곽선이 그 점의 굵기를 정할 때 쓰는 값이다
 * (필압이 없는 획은 속도로 지어낸 값). getStrokeOutlinePoints의 필압 흐름(끝 잡음·꺾인 점 건너뛰기 포함)을 그대로 따른다.
 */
export function drawnLine(stroke: Stroke): number[] {
  const triples = toTriples(stroke.points)
  const opts = outlineOptions(stroke, triples)
  const pts = getStrokePoints(triples, opts)
  const size = opts.size ?? 16
  const simulate = Boolean(opts.thinning) && opts.simulatePressure !== false
  const out: number[] = []
  if (pts.length === 0) return out
  const total = pts[pts.length - 1].runningLength
  let prevPressure = simulate
    ? pts.slice(0, 10).reduce((acc, cur) => (acc + simulatePressure(acc, cur.distance, size)) / 2, pts[0].pressure)
    : 0
  let prevVector = pts[0].vector
  let prevSharp = false
  for (let i = 0; i < pts.length; i++) {
    const { point, vector, distance, runningLength } = pts[i]
    const last = i === pts.length - 1
    const pressure = simulate ? simulatePressure(prevPressure, distance, size) : pts[i].pressure
    out.push(point[0], point[1], pressure)
    if (!simulate) continue
    if (!last && total - runningLength < END_NOISE_THRESHOLD) continue
    // 꺾인 점에서는 외곽선이 둥근 모서리를 그리고 필압 흐름을 넘기지 않는다
    const nextSharp = !last && dot(vector, pts[i + 1].vector) < 0
    if ((dot(vector, prevVector) < 0 && !prevSharp) || nextSharp) {
      if (nextSharp) prevSharp = true
      continue
    }
    prevSharp = false
    if (last) continue
    prevPressure = pressure
    prevVector = vector
  }
  return out
}

/**
 * 중심선 조각(drawnLine을 자른 것)이 그대로 그려지는 저장용 점. streamline을 거꾸로 풀어 각 점이 앞 점에 끌린 뒤
 * 조각의 자리에 닿게 하고(0.1px로 반올림한 값으로 다음 점을 이어 풀어 오차가 쌓이지 않는다), 필압은 그 자리의 굵기 값을 넣는다.
 * 조각 시작 굵기 수준 안의 점은 perfect-freehand가 건너뛰므로 그 구간은 곧은 선이 된다.
 */
export function pointsDrawnAs(stroke: Stroke, line: number[]): number[] {
  const n = Math.floor(line.length / 3)
  if (n === 0) return []
  const opts = outlineOptions(stroke, toTriples(line))
  const t = MIN_STREAMLINE_T + (1 - (opts.streamline ?? 0.5)) * STREAMLINE_T_RANGE
  const size = opts.size ?? 16
  const out = [round1(line[0]), round1(line[1]), round2(line[2])]
  let prev = [out[0], out[1]]
  let runningLength = 0
  let reached = false
  for (let i = 1; i < n; i++) {
    const x = line[i * 3]
    const y = line[i * 3 + 1]
    const p = round2(line[i * 3 + 2])
    const isLast = i === n - 1
    const rx = round1(isLast ? x : prev[0] + (x - prev[0]) / t)
    const ry = round1(isLast ? y : prev[1] + (y - prev[1]) / t)
    out.push(rx, ry, p)
    const point = isLast ? [rx, ry] : [prev[0] + (rx - prev[0]) * t, prev[1] + (ry - prev[1]) * t]
    if (point[0] === prev[0] && point[1] === prev[1]) continue
    runningLength += Math.hypot(point[0] - prev[0], point[1] - prev[1])
    if (!isLast && !reached) {
      if (runningLength < size) continue
      reached = true
    }
    prev = point
  }
  // 넣은 필압이 모두 0.5면 그리기가 속도로 필압을 다시 지어내므로, 한 점만 눈에 안 띄게 비켜 둔다
  if (out.every((v, i) => i % 3 !== 2 || v === 0.5)) out[2] = 0.51
  return out
}
