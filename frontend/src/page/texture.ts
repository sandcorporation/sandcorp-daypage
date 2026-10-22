/**
 * 연필·크레용 획의 종이 결 질감. 펜 종류·색으로 시드를 정한 결정적 무늬라서 확대·스크롤·다른 사람 화면·
 * 이미지 저장에서 몇 번을 다시 그려도 같은 모양이고, 같은 펜·색으로 겹쳐 칠하면 무늬 좌표가 종이 원점 기준이라
 * 결이 끊기지 않고 이어진다. 무늬는 획 색으로 칠한 작은 타일이고, 화소마다 투명도만 다르다(빈 곳으로 종이가 비친다).
 */

export type GrainBrush = 'pencil' | 'crayon'

export const GRAIN_SIZE = 48
/** 무늬 종류 수. 획마다 이 중 하나를 쓴다(만들어 둔 무늬를 다시 쓰려고). */
const VARIANTS = 8

/** 시드 문자열(펜 종류+색) → 무늬 번호(0..VARIANTS-1). */
export function grainSeed(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % VARIANTS
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 타일의 화소별 투명도(0~255). 연필은 고르게 옅은 결, 크레용은 굵은 빈 곳이 많다. */
export function grainAlpha(brush: GrainBrush, seed: number): Uint8ClampedArray {
  const rand = mulberry32((seed + 1) * (brush === 'pencil' ? 7919 : 104729))
  const out = new Uint8ClampedArray(GRAIN_SIZE * GRAIN_SIZE)
  for (let i = 0; i < out.length; i++) {
    const r = rand()
    if (brush === 'pencil') {
      // 대부분 옅게 칠하고, 가끔 비거나 진한 알갱이
      out[i] = r < 0.08 ? 0 : r > 0.9 ? 235 : 120 + Math.floor(rand() * 90)
    } else {
      // 크레용: 가로로 끌린 빈 곳(종이 요철)과 진한 바탕
      out[i] = r < 0.22 ? 0 : 200 + Math.floor(rand() * 55)
    }
  }
  if (brush === 'crayon') {
    // 빈 곳을 가로로 조금 늘려 결처럼 보이게 한다
    for (let y = 0; y < GRAIN_SIZE; y++) {
      for (let x = GRAIN_SIZE - 1; x > 0; x--) {
        const i = y * GRAIN_SIZE + x
        if (out[i - 1] === 0 && rand() < 0.5) out[i] = 0
      }
    }
  }
  return out
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const cache = new Map<string, CanvasPattern | null>()

/** 획 색으로 칠한 질감 무늬. 만들 수 없으면(색 형식이 다르거나 canvas가 없으면) null. */
export function grainPattern(
  ctx: CanvasRenderingContext2D,
  brush: GrainBrush,
  color: string,
  seed: number,
): CanvasPattern | null {
  const key = `${brush}|${color}|${seed}`
  if (cache.has(key)) return cache.get(key)!
  let pattern: CanvasPattern | null = null
  const rgb = parseHex(color)
  if (rgb && typeof document !== 'undefined') {
    const tile = document.createElement('canvas')
    tile.width = GRAIN_SIZE
    tile.height = GRAIN_SIZE
    const tctx = tile.getContext('2d')
    if (tctx) {
      const img = tctx.createImageData(GRAIN_SIZE, GRAIN_SIZE)
      const alpha = grainAlpha(brush, seed)
      for (let i = 0; i < alpha.length; i++) {
        img.data[i * 4] = rgb[0]
        img.data[i * 4 + 1] = rgb[1]
        img.data[i * 4 + 2] = rgb[2]
        img.data[i * 4 + 3] = alpha[i]
      }
      tctx.putImageData(img, 0, 0)
      pattern = ctx.createPattern(tile, 'repeat')
      // 장 좌표 1px에 무늬 0.5칸: 화소보다 고운 결
      pattern?.setTransform?.(new DOMMatrix().scale(0.5))
    }
  }
  if (cache.size > 256) cache.clear()
  cache.set(key, pattern)
  return pattern
}
