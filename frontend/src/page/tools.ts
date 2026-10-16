export type ToolKind = 'pen' | 'highlighter' | 'text' | 'eraser' | 'select'

/** 펜 종류(펜 획의 질감). 형광펜에는 없다. 볼펜이 기본이자 펜 종류가 없는 옛 획의 모양이다. */
export type Brush = 'ballpoint' | 'fountain' | 'pencil' | 'brushpen' | 'crayon'

export const BRUSHES: { id: Brush; name: string; desc: string }[] = [
  { id: 'ballpoint', name: '볼펜', desc: '매끈한 기본 펜' },
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

export function strokeWidth(tool: 'pen' | 'highlighter', level: WidthLevel): number {
  return (tool === 'pen' ? PEN_WIDTHS : HIGHLIGHTER_WIDTHS)[level]
}
