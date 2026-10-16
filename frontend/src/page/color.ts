/** 색 코드(#rrggbb)와 HSV(색상 0~360, 채도·명도 0~1) 변환. 색 만들기 창에서 쓴다. */

/** 노트 색 최대 개수(서버 api.py의 MAX_NOTE_COLORS와 같은 값) */
export const MAX_NOTE_COLORS = 8

/** 기본 잉크와 잘 어울리는 추천 색 */
export const RECOMMENDED_COLORS = ['#16794f', '#0e7490', '#7c3aed', '#db2777', '#b45309', '#65a30d', '#94a3b8', '#f9a8d4']

export type Hsv = { h: number; s: number; v: number }

/** '#16794F', '16794f' → '#16794f'. 여섯 자리 16진수가 아니면 null. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(input.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const hex = (u: number) =>
    Math.round((u + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
