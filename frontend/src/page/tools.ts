export type ToolKind = 'pen' | 'highlighter' | 'shape' | 'text' | 'eraser' | 'select'

/** 펜 종류(펜 획의 질감). 형광펜에는 없다. 볼펜이 기본이자 펜 종류가 없는 옛 획의 모양이다. */
export type Brush = 'ballpoint' | 'fountain' | 'pencil' | 'brushpen' | 'crayon'

export const BRUSHES: { id: Brush; name: string; desc: string }[] = [
  { id: 'ballpoint', name: '볼펜', desc: '매끈한 기본 펜' },
  { id: 'fountain', name: '만년필', desc: '빠르게 쓰면 가늘고, 천천히 쓰면 굵어져요' },
  { id: 'pencil', name: '연필', desc: '사각사각, 종이 결이 보여요' },
  { id: 'brushpen', name: '붓펜', desc: '끝이 가늘게 빠지는 붓글씨' },
  { id: 'crayon', name: '크레용', desc: '거칠고 진한 질감' },
]

export const DEFAULT_BRUSH: Brush = 'ballpoint'

export function isBrush(v: unknown): v is Brush {
  return BRUSHES.some((b) => b.id === v)
}

export const INKS = [
  { name: '잉크 파랑', color: '#2A47B0' },
  { name: '연필 검정', color: '#1F2128' },
  { name: '주황', color: '#E0603A' },
  { name: '형광 노랑', color: '#F2C230' },
] as const

export type WidthLevel = 0 | 1 | 2

export const WIDTH_NAMES = ['가늘게', '보통', '굵게'] as const

const PEN_WIDTHS = [3, 6, 12]
const HIGHLIGHTER_WIDTHS = [14, 24, 36]

/** 직접 정하는 굵기(px)의 범위 */
export const CUSTOM_WIDTH_MIN = 1
export const CUSTOM_WIDTH_MAX = 80

/** 획 굵기(px). 직접 정한 굵기가 있으면 단계 대신 그 값을 펜·형광펜·도형에 그대로 쓴다. */
export function strokeWidth(tool: 'pen' | 'highlighter', level: WidthLevel, customWidth: number | null = null): number {
  return customWidth ?? (tool === 'pen' ? PEN_WIDTHS : HIGHLIGHTER_WIDTHS)[level]
}

/** 입력한 굵기를 범위 안의 정수로 맞춘다. 숫자가 아니면 null. */
export function clampCustomWidth(value: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(CUSTOM_WIDTH_MAX, Math.max(CUSTOM_WIDTH_MIN, Math.round(value)))
}

/**
 * 만년필: 필압이 없는 입력(마우스·터치)에서 쓰는 속도로 필압 값을 만든다. 빠를수록 가늘다.
 * 그릴 때 점에 저장하므로 다른 사람 화면·기록에서도 같은 굵기로 보인다.
 * prev는 앞 점의 값이다. 갑자기 튀지 않게 그쪽에서 조금씩 따라간다.
 */
export function fountainPressure(prev: number, distance: number, ms: number): number {
  const speed = distance / Math.max(ms, 1)
  const target = Math.min(1, Math.max(0.15, 1 - (speed - 0.15) * 0.45))
  const next = prev * 0.6 + target * 0.4
  return Math.round(Math.min(1, Math.max(0.15, next)) * 100) / 100
}
