export type FontId = 'pen' | 'gaegu' | 'gamja' | 'himelody' | 'gothic' | 'myeongjo'

export type FontDef = {
  id: FontId
  name: string
  family: string
  /** 32px 줄에 자연스럽게 앉는 기본 크기 */
  size: number
}

export const FONTS: FontDef[] = [
  { id: 'pen', name: '나눔손글씨 펜', family: "'Nanum Pen Script', cursive", size: 28 },
  { id: 'gaegu', name: '개구', family: "'Gaegu', cursive", size: 22 },
  { id: 'gamja', name: '감자꽃', family: "'Gamja Flower', cursive", size: 22 },
  { id: 'himelody', name: '하이멜로디', family: "'Hi Melody', cursive", size: 24 },
  { id: 'gothic', name: '고딕', family: "'Gothic A1', sans-serif", size: 19 },
  { id: 'myeongjo', name: '명조', family: "'Nanum Myeongjo', serif", size: 19 },
]

export const DEFAULT_FONT = FONTS[0]

export function fontOf(id: string | undefined | null): FontDef {
  return FONTS.find((f) => f.id === id) ?? DEFAULT_FONT
}
