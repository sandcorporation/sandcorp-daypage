/**
 * 획 점([x, y, 필압, ...])을 바이너리 하나로. Yjs에 숫자 배열로 두면 숫자마다 9바이트쯤 들어
 * 색칠처럼 점이 많은 장이 수 MB가 됐다. 점마다 앞 점과의 차이를 가변 길이 정수로 적어 보통 3바이트로 줄인다.
 *
 * [형식 번호 1] 다음 점마다 [dx·10 지그재그 varint][dy·10 지그재그 varint][필압·100 1바이트].
 * 좌표는 0.1, 필압은 0.01 단위로 이미 반올림해 저장하므로 되살린 값이 같다(모양이 그대로다).
 */
export const POINT_FORMAT = 1

function writeVarint(out: number[], n: number): void {
  let z = n >= 0 ? n * 2 : -n * 2 - 1 // 지그재그: 작은 음수도 짧게
  while (z >= 0x80) {
    out.push((z % 0x80) | 0x80)
    z = Math.floor(z / 0x80)
  }
  out.push(z)
}

export function encodePoints(points: number[]): Uint8Array {
  const out: number[] = [POINT_FORMAT]
  let px = 0
  let py = 0
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = Math.round(points[i] * 10)
    const y = Math.round(points[i + 1] * 10)
    writeVarint(out, x - px)
    writeVarint(out, y - py)
    out.push(Math.max(0, Math.min(255, Math.round(points[i + 2] * 100))))
    px = x
    py = y
  }
  return Uint8Array.from(out)
}

export function decodePoints(bytes: Uint8Array): number[] {
  if (bytes[0] !== POINT_FORMAT) return []
  const points: number[] = []
  let i = 1
  const readVarint = () => {
    let z = 0
    let mul = 1
    for (;;) {
      const b = bytes[i++]
      z += (b & 0x7f) * mul
      if (b < 0x80) break
      mul *= 0x80
    }
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2
  }
  let x = 0
  let y = 0
  while (i < bytes.length) {
    x += readVarint()
    y += readVarint()
    points.push(x / 10, y / 10, bytes[i++] / 100)
  }
  return points
}
