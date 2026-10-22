import * as Y from 'yjs'
import { DEFAULT_BRUSH, isBrush, type Brush } from './tools'
import { matrixScale, transformPoints, type Matrix } from './transform'
import { decodePoints, encodePoints } from './pointCodec'

/**
 * 장 하나의 Yjs 문서 구조.
 *
 * strokes:   Y.Map<strokeId, Y.Map{ tool, color, width, points: number[] 또는 pts: Uint8Array, author, createdAt, brush?, steady?, layer? }>
 *            점은 옛 획은 숫자 배열(points), 바이너리로 쓴 획은 pts(pointCodec.ts). 읽을 때는 둘 다 읽는다.
 * layers:    레이어 목록(layers.ts)
 * textboxes: Y.Map<boxId, Y.Map{ x, y, width, color, fontSize, font, content: Y.XmlFragment, author }>
 * meta:      Y.Map{ date }
 */

/** paint는 채색 붓: 색 캔버스에 multiply로 겹친다(render.ts) */
export type Tool = 'pen' | 'highlighter' | 'paint'

export type Stroke = {
  id: string
  tool: Tool
  color: string
  width: number
  /** [x, y, pressure, x, y, pressure, ...] 장 좌표 */
  points: number[]
  author: string
  createdAt: number
  /** 펜 종류. 펜 획에만 있고, 없으면 볼펜 */
  brush?: Brush
  /** 필압을 끄고 그린 획: 굵기가 일정하다 */
  steady?: boolean
  /** 레이어 id. 없으면 기본 레이어(layers.ts) */
  layer?: string
  /** 채색 획의 불투명도(0.1~1). 없으면 DEFAULT_PAINT_OPACITY */
  opacity?: number
  /** 채색 획의 부드러운 가장자리 */
  soft?: boolean
}

/** 획의 펜 종류. 없거나 모르는 값이면 볼펜(옛 획은 지금 모양 그대로). */
export function brushOf(stroke: Stroke): Brush {
  return stroke.tool === 'pen' && isBrush(stroke.brush) ? stroke.brush : DEFAULT_BRUSH
}

export type TextBox = {
  id: string
  x: number
  y: number
  width: number
  color: string
  fontSize: number
  /** 글꼴 id(fonts.ts). 없으면 기본 글꼴 */
  font?: string
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

/**
 * 새 획의 점을 바이너리(pts)로 쓸지. 1단계 배포에서는 읽기만 익힌다(false): 그 전 코드를 쓰는 화면은
 * pts를 모르므로, 모두가 새로고침으로 이 코드를 받은 뒤(다음 배포) 켠다.
 */
export const WRITE_BINARY_POINTS = false

// 바이너리 점을 풀어 둔 것. 다시 그릴 때마다 풀지 않는다(Yjs는 같은 값에 같은 Uint8Array를 돌려준다).
const decoded = new WeakMap<Uint8Array, number[]>()

/** 획의 점. 바이너리(pts)든 옛 숫자 배열(points)이든 읽는다. */
export function strokePoints(m: Y.Map<unknown>): number[] {
  const pts = m.get('pts')
  if (pts instanceof Uint8Array) {
    let points = decoded.get(pts)
    if (!points) {
      points = decodePoints(pts)
      decoded.set(pts, points)
    }
    return points
  }
  return (m.get('points') as number[] | undefined) ?? []
}

/** 이미 있는 획이 바이너리 점인지. 옮기거나 키워도 원래 형식으로 둔다. */
function isBinary(m: Y.Map<unknown>): boolean {
  return m.get('pts') instanceof Uint8Array
}

/** 점을 쓴다. 다른 형식의 키가 남아 있으면 지운다(한 획에 한 형식만). */
function writePoints(m: Y.Map<unknown>, points: number[], binary: boolean): void {
  if (binary) {
    m.set('pts', encodePoints(points))
    if (m.doc && m.has('points')) m.delete('points')
  } else {
    m.set('points', points)
    if (m.doc && m.has('pts')) m.delete('pts')
  }
}

export function addStroke(doc: Y.Doc, stroke: Stroke, origin?: unknown, binary = WRITE_BINARY_POINTS): void {
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('tool', stroke.tool)
    m.set('color', stroke.color)
    m.set('width', stroke.width)
    writePoints(m, stroke.points, binary)
    m.set('author', stroke.author)
    m.set('createdAt', stroke.createdAt)
    // 볼펜은 쓰지 않아도 같은 모양이므로 다른 펜 종류만 남긴다.
    if (stroke.tool === 'pen' && stroke.brush && stroke.brush !== DEFAULT_BRUSH) m.set('brush', stroke.brush)
    if (stroke.tool === 'pen' && stroke.steady) m.set('steady', true)
    if (stroke.tool === 'paint' && typeof stroke.opacity === 'number') m.set('opacity', stroke.opacity)
    if (stroke.tool === 'paint' && stroke.soft) m.set('soft', true)
    if (stroke.layer) m.set('layer', stroke.layer)
    strokesMap(doc).set(stroke.id, m)
  }, origin)
}

export function readStroke(id: string, m: Y.Map<unknown>): Stroke {
  return {
    id,
    tool: m.get('tool') as Tool,
    color: m.get('color') as string,
    width: m.get('width') as number,
    points: strokePoints(m),
    author: m.get('author') as string,
    createdAt: m.get('createdAt') as number,
    ...(m.has('brush') ? { brush: m.get('brush') as Brush } : {}),
    ...(m.get('steady') === true ? { steady: true } : {}),
    ...(typeof m.get('layer') === 'string' ? { layer: m.get('layer') as string } : {}),
    ...(typeof m.get('opacity') === 'number' ? { opacity: m.get('opacity') as number } : {}),
    ...(m.get('soft') === true ? { soft: true } : {}),
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
      const points = strokePoints(m)
      writePoints(
        m,
        points.map((v, i) => (i % 3 === 0 ? round(v + dx) : i % 3 === 1 ? round(v + dy) : v)),
        isBinary(m),
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
    if (box.font) m.set('font', box.font)
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
    font: (m.get('font') as string | undefined) ?? undefined,
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
  // toString()은 서식을 태그로 감싸므로, 사용자가 쓴 꺾쇠와 구분되게 델타에서 글자만 모은다.
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as { insert: unknown }[]).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('')
  }
  if (node instanceof Y.XmlElement) {
    if (node.nodeName === 'hardBreak') return '\n'
    return node.toArray().map((c) => xmlText(c as Y.XmlElement | Y.XmlText)).join('')
  }
  return ''
}

export function updateTextBox(
  doc: Y.Doc,
  id: string,
  patch: Partial<Pick<TextBox, 'x' | 'y' | 'width' | 'font' | 'fontSize' | 'color'>>,
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

/**
 * 획들을 행렬 m으로 옮기고·키우고·돌린다(필압은 그대로). 키운 만큼 굵기도 함께 키운다.
 * 손을 뗀 순간 한 번만 쓰고, 끄는 동안은 화면에서만 미리 보인다.
 */
export function transformStrokes(doc: Y.Doc, ids: string[], m: Matrix, origin?: unknown): void {
  if (ids.length === 0) return
  const k = matrixScale(m)
  doc.transact(() => {
    for (const id of ids) {
      const s = strokesMap(doc).get(id)
      if (!s) continue
      writePoints(s, transformPoints(strokePoints(s), m), isBinary(s))
      if (Math.abs(k - 1) > 1e-6) s.set('width', round((s.get('width') as number) * k))
    }
  }, origin)
}
