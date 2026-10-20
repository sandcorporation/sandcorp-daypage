import type { TextBox } from './doc'
import { fontOf } from './fonts'

type Marks = Record<string, Record<string, unknown> | undefined>

export type ResolvedStyle = {
  family: string
  size: number
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  canvasFont: string
}

/** 글자 크기 마크(작게·크게는 '0.8em'처럼 비율, 직접 정하면 '30px')를 상자 기본 크기에 맞춰 px로. */
export function resolveFontSize(base: number, mark: string | null | undefined): number {
  const n = mark ? parseFloat(mark) : NaN
  if (!Number.isFinite(n)) return base
  if (mark?.endsWith('px')) return Math.round(n)
  if (mark?.endsWith('em')) return Math.round(base * n)
  return base
}

/** 글 상자 속성과 서식 마크를 합쳐 실제 글자 모양을 정한다(화면·PNG 공용). */
export function textStyle(box: Pick<TextBox, 'color' | 'fontSize' | 'font'>, marks: Marks): ResolvedStyle {
  const family = fontOf(box.font).family
  const ts = (marks.textStyle ?? {}) as { color?: string | null; fontSize?: string | null }
  const size = resolveFontSize(box.fontSize, ts.fontSize)
  const bold = !!marks.bold
  const italic = !!marks.italic
  return {
    family,
    size,
    color: ts.color || box.color,
    bold,
    italic,
    underline: !!marks.underline,
    strike: !!marks.strike,
    canvasFont: `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${size}px ${family}`,
  }
}
