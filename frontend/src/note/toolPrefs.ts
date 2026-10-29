import { DEFAULT_ERASE_FILTER, DEFAULT_ERASER_MODE, isEraseFilter, isEraserMode, type EraseFilter, type EraserMode } from '../page/erase'
import { DEFAULT_FONT, FONTS } from '../page/fonts'
import { DEFAULT_PEN_ONLY, isPenOnlyMode, type PenOnlyMode } from '../page/penOnly'
import { DEFAULT_SHAPE, isShape, isShapeFill, type ShapeFill, type ShapeKind } from '../page/shapes'
import {
  clampCustomWidth,
  clampOpacity,
  DEFAULT_BRUSH,
  DEFAULT_PAINT_OPACITY,
  INKS,
  isBrush,
  PAINT_WIDTH_MAX,
  RECENT_INKS_MAX,
  type Brush,
  type ToolKind,
  type WidthLevel,
} from '../page/tools'

/** 이 브라우저에서 마지막으로 고른 도구 설정. 사람마다·기기마다 다른 편의 설정이라 브라우저에만 둔다. */
export type ToolPrefs = {
  tool: ToolKind
  ink: string
  widthLevel: WidthLevel
  /** 직접 정한 굵기(px). 있으면 단계 대신 쓴다 */
  customWidth: number | null
  font: string
  brush: Brush
  /** 도형 도구에서 고른 도형과 닫힌 도형의 채움(0이면 테두리만) */
  shape: ShapeKind
  shapeFill: ShapeFill
  /** 필압 따라 굵기 바꾸기 */
  pressure: boolean
  /** 펜 전용 모드(penOnly.ts): 펜을 쓰면 손가락은 스크롤만 */
  penOnly: PenOnlyMode
  /** 화면 고정: 손가락·휠로 화면이 움직이거나 확대되지 않는다 */
  viewLock: boolean
  /** 지우개 크기 단계와 직접 정한 지름(px). 있으면 단계 대신 쓴다 */
  eraserLevel: WidthLevel
  eraserWidth: number | null
  /** 지우개 방식(범위·획·올가미)과 지울 대상 거르기(모두·펜만·형광펜만) */
  eraserMode: EraserMode
  eraseFilter: EraseFilter
  /** 채색 붓: 굵기 단계·직접 정한 굵기(px, 최대 200)·불투명도(0.1~1)·부드러운 가장자리 */
  paintLevel: WidthLevel
  paintWidth: number | null
  paintOpacity: number
  paintSoft: boolean
  /** 최근 쓴 잉크(#rrggbb, 최신이 앞, 최대 6) */
  recentInks: string[]
  /** 선택·이동이 내가 그린 획만 고르게(남의 획을 잘못 옮기지 않게) */
  selectMine: boolean
  /** 선택·이동이 빈 곳에서 끌 때 상자 대신 올가미(지나간 길)로 두르기 */
  selectLasso: boolean
}

export const DEFAULT_TOOL_PREFS: ToolPrefs = {
  tool: 'pen',
  ink: INKS[0].color,
  widthLevel: 1,
  customWidth: null,
  font: DEFAULT_FONT.id,
  brush: DEFAULT_BRUSH,
  shape: DEFAULT_SHAPE,
  shapeFill: 0,
  pressure: true,
  penOnly: DEFAULT_PEN_ONLY,
  viewLock: false,
  eraserLevel: 1,
  eraserWidth: null,
  eraserMode: DEFAULT_ERASER_MODE,
  eraseFilter: DEFAULT_ERASE_FILTER,
  paintLevel: 1,
  paintWidth: null,
  paintOpacity: DEFAULT_PAINT_OPACITY,
  paintSoft: false,
  recentInks: [],
  selectMine: false,
  selectLasso: false,
}

const KEY = 'daypage:tool-prefs'

function isHexColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}
const TOOLS: ToolKind[] = ['pen', 'highlighter', 'paint', 'shape', 'text', 'eraser', 'select']

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
    shapeFill: isShapeFill(raw.shapeFill) ? raw.shapeFill : d.shapeFill,
    pressure: typeof raw.pressure === 'boolean' ? raw.pressure : d.pressure,
    penOnly: isPenOnlyMode(raw.penOnly) ? raw.penOnly : d.penOnly,
    viewLock: typeof raw.viewLock === 'boolean' ? raw.viewLock : d.viewLock,
    eraserLevel: [0, 1, 2].includes(raw.eraserLevel as number) ? (raw.eraserLevel as WidthLevel) : d.eraserLevel,
    eraserWidth: typeof raw.eraserWidth === 'number' ? clampCustomWidth(raw.eraserWidth) : null,
    eraserMode: isEraserMode(raw.eraserMode) ? raw.eraserMode : d.eraserMode,
    eraseFilter: isEraseFilter(raw.eraseFilter) ? raw.eraseFilter : d.eraseFilter,
    paintLevel: [0, 1, 2].includes(raw.paintLevel as number) ? (raw.paintLevel as WidthLevel) : d.paintLevel,
    paintWidth: typeof raw.paintWidth === 'number' ? clampCustomWidth(raw.paintWidth, PAINT_WIDTH_MAX) : null,
    paintOpacity: (typeof raw.paintOpacity === 'number' && clampOpacity(raw.paintOpacity)) || d.paintOpacity,
    paintSoft: typeof raw.paintSoft === 'boolean' ? raw.paintSoft : d.paintSoft,
    recentInks: Array.isArray(raw.recentInks) ? raw.recentInks.filter(isHexColor).slice(0, RECENT_INKS_MAX) : [],
    selectMine: typeof raw.selectMine === 'boolean' ? raw.selectMine : d.selectMine,
    selectLasso: typeof raw.selectLasso === 'boolean' ? raw.selectLasso : d.selectLasso,
  }
}

export function saveToolPrefs(prefs: ToolPrefs, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 저장할 수 없으면(시크릿 창, 저장소 차단) 이번 방문 동안만 기억한다.
  }
}
