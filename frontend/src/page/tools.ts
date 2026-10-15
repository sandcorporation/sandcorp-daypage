export type ToolKind = 'pen' | 'highlighter' | 'text' | 'eraser' | 'select'

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
