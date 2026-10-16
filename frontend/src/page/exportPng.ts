import * as Y from 'yjs'
import { readStrokes, readTextBoxes, textBoxContent, type TextBox } from './doc'
import { LINE_GAP, PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { layerPlan, readLayers } from './layers'
import { paintLayers, paintPaper } from './render'
import { textStyle } from './textStyle'

export type Marks = Record<string, Record<string, unknown> | undefined>
export type Run = { text: string; marks: Marks }

/** 글 상자 내용을 문단마다 서식 조각 배열로 읽는다. */
export function paragraphsOf(doc: Y.Doc, boxId: string): Run[][] {
  const fragment = textBoxContent(doc, boxId)
  if (!fragment) return []
  return fragment.toArray().map((node) => {
    const runs: Run[] = []
    const visit = (n: unknown) => {
      if (n instanceof Y.XmlText) {
        for (const op of n.toDelta() as { insert: unknown; attributes?: Marks }[]) {
          if (typeof op.insert === 'string') runs.push({ text: op.insert, marks: op.attributes ?? {} })
        }
      } else if (n instanceof Y.XmlElement) {
        if (n.nodeName === 'hardBreak') runs.push({ text: '\n', marks: {} })
        n.toArray().forEach(visit)
      }
    }
    visit(node)
    return runs
  })
}

/** 문단의 서식 조각을 줄바꿈(Shift+Enter) 기준으로 나눈다. */
export function linesOf(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, marks: run.marks })
    })
  }
  return lines
}

/** 한 줄을 폭에 맞춰 접는다. 공백에서 먼저 끊고, 한 단어가 너무 길면 글자 단위로 자른다. */
export function wrapLine(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (text === '') return ['']
  const words = text.match(/\S+\s*|\s+/g) ?? [text]
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (measure(line + word) <= maxWidth) {
      line += word
      continue
    }
    if (line) lines.push(line)
    line = ''
    if (measure(word) <= maxWidth) {
      line = word
      continue
    }
    for (const ch of word) {
      if (measure(line + ch) > maxWidth && line) {
        lines.push(line)
        line = ''
      }
      line += ch
    }
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}

type Piece = { text: string; marks: Marks }

function wrapRuns(ctx: CanvasRenderingContext2D, runs: Run[], box: TextBox, maxWidth: number): Piece[][] {
  // 서식이 섞인 문단을 글자 단위로 이어 붙이며 줄을 나눈다.
  const lines: Piece[][] = [[]]
  const text = runs.map((r) => r.text).join('')
  const plainLines = wrapLine(text, maxWidth, (s) => {
    ctx.font = textStyle(box, {}).canvasFont
    return ctx.measureText(s).width
  })
  // 줄 경계(글자 위치)를 서식 조각에 적용한다.
  const breaks = new Set<number>()
  let pos = 0
  for (const l of plainLines.slice(0, -1)) {
    // 서식 조각은 코드 포인트 단위로 세므로 여기서도 같은 단위로 센다(이모지 등 서로게이트 쌍).
    pos += Array.from(l).length
    breaks.add(pos)
  }
  let index = 0
  for (const run of runs) {
    let chunk = ''
    for (const ch of run.text) {
      if (breaks.has(index) && (chunk || lines[lines.length - 1].length)) {
        if (chunk) lines[lines.length - 1].push({ text: chunk, marks: run.marks })
        lines.push([])
        chunk = ''
      }
      chunk += ch
      index++
    }
    if (chunk) lines[lines.length - 1].push({ text: chunk, marks: run.marks })
  }
  return lines
}

function paintTextBox(ctx: CanvasRenderingContext2D, doc: Y.Doc, box: TextBox): void {
  const padding = 6
  const maxWidth = box.width - padding * 2
  let y = box.y
  const hardLines = paragraphsOf(doc, box.id).flatMap(linesOf)
  for (const runs of hardLines) {
    for (const line of runs.length ? wrapRuns(ctx, runs, box, maxWidth) : [[]]) {
      let x = box.x + padding
      for (const piece of line) {
        const style = textStyle(box, piece.marks)
        ctx.font = style.canvasFont
        ctx.fillStyle = style.color
        ctx.textBaseline = 'middle'
        const baseline = y + LINE_GAP / 2
        ctx.fillText(piece.text, x, baseline)
        const w = ctx.measureText(piece.text).width
        if (style.underline || style.strike) {
          ctx.fillRect(x, style.underline ? baseline + style.size * 0.45 : baseline, w, Math.max(1, style.size / 14))
        }
        x += w
      }
      y += LINE_GAP
    }
  }
}

/** 장 전체를 한 장의 PNG로 그린다(종이 + 획 + 글 상자). */
export async function renderPagePng(doc: Y.Doc, pixelScale = 1): Promise<Blob> {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_WIDTH * pixelScale
  canvas.height = PAGE_HEIGHT * pixelScale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas를 쓸 수 없어요')
  paintPaper(ctx, pixelScale)
  // 내가 숨긴 레이어도 담는다(모두가 본 페이지 그대로).
  paintLayers(ctx, layerPlan(readStrokes(doc), readLayers(doc)), pixelScale)
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
  for (const box of readTextBoxes(doc)) paintTextBox(ctx, doc, box)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했어요'))), 'image/png'),
  )
}

export function exportFileName(noteName: string, date: string): string {
  const safe = noteName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'note'
  return `daypage-${safe}-${date}.png`
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
