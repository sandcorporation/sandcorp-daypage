import type { TextBox } from './doc'

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

/** 글 상자 속성과 서식 마크를 합쳐 실제 글자 모양을 정한다(화면·PNG 공용). */
export function textStyle(box: Pick<TextBox, 'color' | 'fontSize'>, marks: Marks): ResolvedStyle {
  const family = "'Nanum Pen Script', cursive"
  const size = box.fontSize
  const bold = !!marks.bold
  const italic = !!marks.italic
  return {
    family,
    size,
    color: box.color,
    bold,
    italic,
    underline: !!marks.underline,
    strike: !!marks.strike,
    canvasFont: `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${size}px ${family}`,
  }
}
