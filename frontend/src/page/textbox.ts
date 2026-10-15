import * as Y from 'yjs'
import { addTextBox, deleteTextBox, newId, readTextBoxes, round, textBoxText } from './doc'
import { LINE_GAP, PAGE_HEIGHT, PAGE_WIDTH, snapToLine, type Point } from './geometry'
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

/**
 * 편집을 마칠 때 지워도 되는 빈 상자인지. 내가 만든 상자이고, 다른 사람이 지금 쓰고 있지 않을 때만.
 * (남이 막 만든 빈 상자를 내가 눌렀다 떼도 지워지지 않게)
 */
export function shouldRemoveOnBlur(doc: Y.Doc, id: string, me: string, othersEditing: boolean): boolean {
  const box = readTextBoxes(doc).find((b) => b.id === id)
  if (!box || box.author !== me || othersEditing) return false
  return textBoxText(doc, id).trim() === ''
}

/** 내용이 비었으면 상자를 지우고 true. */
export function removeIfEmpty(doc: Y.Doc, id: string, origin?: unknown): boolean {
  if (textBoxText(doc, id).trim() !== '') return false
  deleteTextBox(doc, id, origin)
  return true
}

/** 옮긴 상자 위치: 줄에 맞추고, 상자 폭까지 장 안에 들어오게 한다. */
export function snapBoxPosition(p: Point, width: number = MIN_BOX_WIDTH): Point {
  const maxX = Math.max(0, PAGE_WIDTH - width)
  return {
    x: round(Math.max(0, Math.min(p.x, maxX))),
    y: Math.min(snapToLine(p.y), PAGE_HEIGHT - LINE_GAP),
  }
}

const NUDGE_X = 8

/** 옮기기 손잡이에서 화살표 키로 옮길 위치. 화살표가 아니면 null. */
export function nudgeBox(box: { x: number; y: number; width: number }, key: string): Point | null {
  const step: Record<string, [number, number]> = {
    ArrowLeft: [-NUDGE_X, 0],
    ArrowRight: [NUDGE_X, 0],
    ArrowUp: [0, -LINE_GAP],
    ArrowDown: [0, LINE_GAP],
  }
  const d = step[key]
  if (!d) return null
  return snapBoxPosition({ x: box.x + d[0], y: box.y + d[1] }, box.width)
}
