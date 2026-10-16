import * as Y from 'yjs'
import { addTextBox, deleteTextBox, newId, readTextBoxes, round, textBoxText } from './doc'
import { LINE_GAP, PAGE_HEIGHT, PAGE_WIDTH, rowTop, snapToLine, type Point } from './geometry'
import { fontOf } from './fonts'

export const DEFAULT_BOX_WIDTH = 360
export const MIN_BOX_WIDTH = 120

export function clampBoxWidth(width: number, x: number): number {
  return Math.round(Math.max(MIN_BOX_WIDTH, Math.min(width, PAGE_WIDTH - x)))
}

/** 누른 자리에 글 상자를 만든다. 세로 위치는 누른 칸의 위쪽 경계. */
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
      y: rowTop(p.y),
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

/**
 * 줄이 늘어 장 아래로 넘친 상자의 새 위쪽 위치. 넘치지 않으면 그대로 두고,
 * 넘치면 칸 단위로 끌어올린다(장 밖의 글은 누구에게도 보이지 않으므로).
 */
export function fitBoxInPage(y: number, height: number): number {
  if (y + height <= PAGE_HEIGHT) return y
  return Math.max(0, Math.floor((PAGE_HEIGHT - height) / LINE_GAP) * LINE_GAP)
}

/**
 * 들어올 때 정리: 내가 만든 빈 상자 중 지금 아무도 쓰고 있지 않은 것을 지운다.
 * 빈 상자는 편집을 마칠 때 지우지만, 새로고침하거나 나가면 그 단계 없이 남는다.
 * 되돌리기 대상이 아니다(origin 없이 지운다). 지운 상자 id를 돌려준다.
 */
export function removeLeftoverEmptyBoxes(doc: Y.Doc, me: string, editing: ReadonlySet<string>): string[] {
  const ids = readTextBoxes(doc)
    .filter((b) => b.author === me && !editing.has(b.id) && textBoxText(doc, b.id).trim() === '')
    .map((b) => b.id)
  if (ids.length) doc.transact(() => ids.forEach((id) => deleteTextBox(doc, id)))
  return ids
}
