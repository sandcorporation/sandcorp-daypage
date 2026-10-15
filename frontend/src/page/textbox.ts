import * as Y from 'yjs'
import { addTextBox, deleteTextBox, newId, round, textBoxText } from './doc'
import { PAGE_WIDTH, snapToLine, type Point } from './geometry'
import { fontOf } from './fonts'

export const DEFAULT_BOX_WIDTH = 360
export const MIN_BOX_WIDTH = 120

export function clampBoxWidth(width: number, x: number): number {
  return Math.round(Math.max(MIN_BOX_WIDTH, Math.min(width, PAGE_WIDTH - x)))
}

/** 누른 자리에 글 상자를 만든다. 세로 위치는 줄에 맞춘다. */
export function createTextBoxAt(
  doc: Y.Doc,
  p: Point,
  opts: { color: string; author: string; font?: string },
  origin?: unknown,
): string {
  const id = newId()
  const x = Math.round(Math.min(p.x, PAGE_WIDTH - MIN_BOX_WIDTH))
  addTextBox(
    doc,
    {
      id,
      x,
      y: snapToLine(p.y),
      width: clampBoxWidth(DEFAULT_BOX_WIDTH, x),
      color: opts.color,
      fontSize: fontOf(opts.font).size,
      font: fontOf(opts.font).id,
      author: opts.author,
    },
    origin,
  )
  return id
}

/** 내용이 비었으면 상자를 지우고 true. */
export function removeIfEmpty(doc: Y.Doc, id: string, origin?: unknown): boolean {
  if (textBoxText(doc, id).trim() !== '') return false
  deleteTextBox(doc, id, origin)
  return true
}

export function snapBoxPosition(p: Point): Point {
  return { x: round(Math.max(0, Math.min(p.x, PAGE_WIDTH - MIN_BOX_WIDTH))), y: snapToLine(p.y) }
}
