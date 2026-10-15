import * as Y from 'yjs'

/**
 * 장 하나의 Yjs 문서 구조.
 *
 * strokes:   Y.Map<strokeId, Y.Map{ tool, color, width, points: number[], author, createdAt }>
 * textboxes: Y.Map<boxId, Y.Map{ x, y, width, color, fontSize, content: Y.XmlFragment, author }>
 * meta:      Y.Map{ date }
 */

export type Tool = 'pen' | 'highlighter'

export type Stroke = {
  id: string
  tool: Tool
  color: string
  width: number
  /** [x, y, pressure, x, y, pressure, ...] 장 좌표 */
  points: number[]
  author: string
  createdAt: number
}

export type TextBox = {
  id: string
  x: number
  y: number
  width: number
  color: string
  fontSize: number
  author: string
}

export const STROKES = 'strokes'
export const TEXTBOXES = 'textboxes'
export const META = 'meta'

export function strokesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(STROKES)
}

export function textboxesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(TEXTBOXES)
}

export function createPageDoc(date: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap(META).set('date', date)
  return doc
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

export function addStroke(doc: Y.Doc, stroke: Stroke, origin?: unknown): void {
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('tool', stroke.tool)
    m.set('color', stroke.color)
    m.set('width', stroke.width)
    m.set('points', stroke.points)
    m.set('author', stroke.author)
    m.set('createdAt', stroke.createdAt)
    strokesMap(doc).set(stroke.id, m)
  }, origin)
}

export function readStroke(id: string, m: Y.Map<unknown>): Stroke {
  return {
    id,
    tool: m.get('tool') as Tool,
    color: m.get('color') as string,
    width: m.get('width') as number,
    points: m.get('points') as number[],
    author: m.get('author') as string,
    createdAt: m.get('createdAt') as number,
  }
}

export function readStrokes(doc: Y.Doc): Stroke[] {
  return Array.from(strokesMap(doc).entries()).map(([id, m]) => readStroke(id, m))
}

export function deleteStrokes(doc: Y.Doc, ids: string[], origin?: unknown): void {
  if (ids.length === 0) return
  doc.transact(() => {
    for (const id of ids) strokesMap(doc).delete(id)
  }, origin)
}

/** 획을 dx, dy만큼 옮긴다. */
export function moveStrokes(doc: Y.Doc, ids: string[], dx: number, dy: number, origin?: unknown): void {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return
  doc.transact(() => {
    for (const id of ids) {
      const m = strokesMap(doc).get(id)
      if (!m) continue
      const points = m.get('points') as number[]
      m.set(
        'points',
        points.map((v, i) => (i % 3 === 0 ? round(v + dx) : i % 3 === 1 ? round(v + dy) : v)),
      )
    }
  }, origin)
}

export function addTextBox(doc: Y.Doc, box: TextBox, origin?: unknown): void {
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('x', box.x)
    m.set('y', box.y)
    m.set('width', box.width)
    m.set('color', box.color)
    m.set('fontSize', box.fontSize)
    m.set('author', box.author)
    m.set('content', new Y.XmlFragment())
    textboxesMap(doc).set(box.id, m)
  }, origin)
}

export function readTextBox(id: string, m: Y.Map<unknown>): TextBox {
  return {
    id,
    x: m.get('x') as number,
    y: m.get('y') as number,
    width: m.get('width') as number,
    color: m.get('color') as string,
    fontSize: m.get('fontSize') as number,
    author: m.get('author') as string,
  }
}

export function readTextBoxes(doc: Y.Doc): TextBox[] {
  return Array.from(textboxesMap(doc).entries()).map(([id, m]) => readTextBox(id, m))
}

export function textBoxContent(doc: Y.Doc, id: string): Y.XmlFragment | undefined {
  return textboxesMap(doc).get(id)?.get('content') as Y.XmlFragment | undefined
}

export function textBoxText(doc: Y.Doc, id: string): string {
  const fragment = textBoxContent(doc, id)
  if (!fragment) return ''
  return fragment
    .toArray()
    .map((node) => xmlText(node))
    .join('\n')
}

function xmlText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]+>/g, '')
  if (node instanceof Y.XmlElement) return node.toArray().map((c) => xmlText(c as Y.XmlElement | Y.XmlText)).join('')
  return ''
}

export function updateTextBox(
  doc: Y.Doc,
  id: string,
  patch: Partial<Pick<TextBox, 'x' | 'y' | 'width'>>,
  origin?: unknown,
): void {
  const m = textboxesMap(doc).get(id)
  if (!m) return
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) m.set(k, v)
  }, origin)
}

export function deleteTextBox(doc: Y.Doc, id: string, origin?: unknown): void {
  doc.transact(() => textboxesMap(doc).delete(id), origin)
}

export function isPageEmpty(doc: Y.Doc): boolean {
  return strokesMap(doc).size === 0 && textboxesMap(doc).size === 0
}

export function round(v: number): number {
  return Math.round(v * 10) / 10
}
