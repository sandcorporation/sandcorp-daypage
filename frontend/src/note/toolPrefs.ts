import { DEFAULT_FONT, FONTS } from '../page/fonts'
import { DEFAULT_SHAPE, isShape, type ShapeKind } from '../page/shapes'
import { clampCustomWidth, DEFAULT_BRUSH, INKS, isBrush, type Brush, type ToolKind, type WidthLevel } from '../page/tools'

/** 이 브라우저에서 마지막으로 고른 도구 설정. 사람마다·기기마다 다른 편의 설정이라 브라우저에만 둔다. */
export type ToolPrefs = {
  tool: ToolKind
  ink: string
  widthLevel: WidthLevel
  /** 직접 정한 굵기(px). 있으면 단계 대신 쓴다 */
  customWidth: number | null
  font: string
  brush: Brush
  /** 도형 도구에서 고른 도형 */
  shape: ShapeKind
  /** 필압 따라 굵기 바꾸기 */
  pressure: boolean
}

export const DEFAULT_TOOL_PREFS: ToolPrefs = {
  tool: 'pen',
  ink: INKS[0].color,
  widthLevel: 1,
  customWidth: null,
  font: DEFAULT_FONT.id,
  brush: DEFAULT_BRUSH,
  shape: DEFAULT_SHAPE,
  pressure: true,
}

const KEY = 'daypage:tool-prefs'

function isHexColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}
const TOOLS: ToolKind[] = ['pen', 'highlighter', 'shape', 'text', 'eraser', 'select']

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 저장된 값을 읽는다. 항목마다 검사해, 모르는 값은 그 항목만 기본값으로 둔다. */
export function loadToolPrefs(storage: StorageLike | null = defaultStorage()): ToolPrefs {
  let raw: Partial<Record<keyof ToolPrefs, unknown>> = {}
  try {
    const text = storage?.getItem(KEY)
    if (text) raw = JSON.parse(text)
  } catch {
    return DEFAULT_TOOL_PREFS
  }
  const d = DEFAULT_TOOL_PREFS
  return {
    tool: TOOLS.includes(raw.tool as ToolKind) ? (raw.tool as ToolKind) : d.tool,
    // 기본 잉크이거나 노트 색(#rrggbb). 노트 색이 빠졌는지는 노트를 연 뒤 확인한다.
    ink: INKS.some((i) => i.color === raw.ink) || isHexColor(raw.ink) ? (raw.ink as string) : d.ink,
    widthLevel: [0, 1, 2].includes(raw.widthLevel as number) ? (raw.widthLevel as WidthLevel) : d.widthLevel,
    customWidth: typeof raw.customWidth === 'number' ? clampCustomWidth(raw.customWidth) : null,
    font: FONTS.some((f) => f.id === raw.font) ? (raw.font as string) : d.font,
    brush: isBrush(raw.brush) ? raw.brush : d.brush,
    shape: isShape(raw.shape) ? raw.shape : d.shape,
    pressure: typeof raw.pressure === 'boolean' ? raw.pressure : d.pressure,
  }
}

export function saveToolPrefs(prefs: ToolPrefs, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 저장할 수 없으면(시크릿 창, 저장소 차단) 이번 방문 동안만 기억한다.
  }
}
