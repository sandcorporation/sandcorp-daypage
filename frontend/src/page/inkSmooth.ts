/**
 * 손글씨 점 고르기. 아이패드 Safari 등은 펜 좌표를 화면 정수 픽셀로 잘라 주어, 확대를 줄인 지면에서 가는 획이
 * 1px 계단을 따라 꺾여 군데군데 홈이 팬 것처럼 보였다(운영 기록: 점 사이 이동이 1.67·3.3·5.0, 화면 1px의 배수).
 *
 * 잘린 좌표의 참값은 그 점에서 반 픽셀 안에 있다. 그래서 크게 고른 뒤 각 점을 원래 자리의 반 픽셀 상자 안으로
 * 되돌리기를 몇 번 되풀이한다. 계단은 상자를 가로지르는 곧은 선으로 펴지고, 꺾인 모서리는 반 픽셀 넘게
 * 움직이지 못해 그대로 남는다. 첫 점·마지막 점과 필압은 그대로 둔다.
 */

const ROUNDS = 6

/** 획을 따라 잰 거리로 가우스 가중 평균(양 끝 가까이에서는 끝까지의 거리로 창을 줄인다) */
function blur(pts: number[], sigma: number, from: number): number[] {
  const n = pts.length / 3
  const out = pts.slice()
  const arc = new Float64Array(n)
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2])
  const total = arc[n - 1]
  for (let i = Math.max(1, from); i < n - 1; i++) {
    const r = Math.min(sigma * 3, arc[i], total - arc[i])
    if (r <= 0) continue
    const s = r / 3
    let wx = 0
    let wy = 0
    let w = 0
    for (let j = i; j >= 0 && arc[i] - arc[j] <= r; j--) {
      const k = Math.exp(-0.5 * ((arc[i] - arc[j]) / s) ** 2)
      wx += pts[j * 3] * k
      wy += pts[j * 3 + 1] * k
      w += k
    }
    for (let j = i + 1; j < n && arc[j] - arc[i] <= r; j++) {
      const k = Math.exp(-0.5 * ((arc[j] - arc[i]) / s) ** 2)
      wx += pts[j * 3] * k
      wy += pts[j * 3 + 1] * k
      w += k
    }
    out[i * 3] = wx / w
    out[i * 3 + 1] = wy / w
  }
  return out
}

/**
 * 점 [x, y, 필압, ...]을 고른다. pixel은 화면 1px의 장 좌표 길이(1/배율). from 앞의 점은 이미 골라 두었으면
 * 그대로 두어도 된다(긋는 동안 끝부분만 다시 고를 때).
 */
export function smoothPoints(raw: number[], pixel: number, from = 0): number[] {
  const n = raw.length / 3
  if (n < 3 || pixel <= 0) return raw.slice()
  const half = pixel / 2
  let pts = raw.slice()
  for (let round = 0; round < ROUNDS; round++) {
    pts = blur(pts, pixel * 3, from)
    for (let i = Math.max(1, from); i < n - 1; i++) {
      for (const k of [0, 1]) {
        const v = pts[i * 3 + k]
        const c = raw[i * 3 + k]
        pts[i * 3 + k] = v < c - half ? c - half : v > c + half ? c + half : v
      }
    }
  }
  return pts
}

/** 긋는 동안 다시 고를 첫 점: 끝에서 이만큼(장 좌표 길이) 안의 점만 바뀐다고 보고 그 앞은 굳힌다 */
export function smoothTailFrom(raw: number[], pixel: number): number {
  const n = raw.length / 3
  const reach = pixel * 3 * 3 * 2
  let i = n - 1
  let dist = 0
  while (i > 1 && dist <= reach) {
    dist += Math.hypot(raw[i * 3] - raw[i * 3 - 3], raw[i * 3 + 1] - raw[i * 3 - 2])
    i--
  }
  return i
}
