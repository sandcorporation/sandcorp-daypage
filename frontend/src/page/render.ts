import { getStroke } from 'perfect-freehand'
import type { Stroke } from './doc'
import { LINE_GAP, MARGIN_X, PAGE_HEIGHT, PAGE_WIDTH } from './geometry'

export const HIGHLIGHTER_ALPHA = 0.45

/** 형광펜이 항상 펜 아래에 오도록, 같은 도구 안에서는 그린 순서대로. */
export function orderStrokes(strokes: Stroke[]): Stroke[] {
  const rank = (s: Stroke) => (s.tool === 'highlighter' ? 0 : 1)
  return [...strokes].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

function toTriples(points: number[]): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]])
  return out
}

/** perfect-freehand 외곽선(펜) 또는 굵은 선(형광펜)을 Path2D로. */
export function strokePath(stroke: Stroke): Path2D {
  const triples = toTriples(stroke.points)
  const path = new Path2D()
  if (stroke.tool === 'highlighter') {
    if (triples.length === 0) return path
    path.moveTo(triples[0][0], triples[0][1])
    for (const [x, y] of triples.slice(1)) path.lineTo(x, y)
    if (triples.length === 1) path.lineTo(triples[0][0] + 0.1, triples[0][1])
    return path
  }
  const outline = getStroke(triples, {
    size: stroke.width,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: triples.every(([, , p]) => p === 0.5),
    last: true,
  })
  if (outline.length === 0) return path
  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  path.closePath()
  return path
}

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const path = strokePath(stroke)
  if (stroke.tool === 'highlighter') {
    ctx.save()
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(path)
    ctx.restore()
    return
  }
  ctx.fillStyle = stroke.color
  ctx.fill(path)
}

/**
 * 획을 두 층으로 그린다. 형광펜은 따로 불투명하게 모아 그린 뒤 반투명으로 합쳐
 * 겹친 곳이 진해지지 않게 하고, 그 위에 펜을 그린다.
 */
export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], pixelScale: number): void {
  const ordered = orderStrokes(strokes)
  const highlights = ordered.filter((s) => s.tool === 'highlighter')
  const pens = ordered.filter((s) => s.tool === 'pen')

  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
  if (highlights.length) {
    const layer = document.createElement('canvas')
    layer.width = ctx.canvas.width
    layer.height = ctx.canvas.height
    const lctx = layer.getContext('2d')
    if (lctx) {
      lctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
      for (const s of highlights) paintStroke(lctx, s)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = HIGHLIGHTER_ALPHA
      ctx.drawImage(layer, 0, 0)
      ctx.restore()
    }
  }
  for (const s of pens) paintStroke(ctx, s)
}

/** 줄노트 종이(이미지 저장용). 화면에서는 CSS 배경을 쓴다. */
export function paintPaper(ctx: CanvasRenderingContext2D, pixelScale: number): void {
  ctx.save()
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  ctx.strokeStyle = '#e9ecf2'
  ctx.lineWidth = 1
  for (let y = LINE_GAP; y < PAGE_HEIGHT; y += LINE_GAP) {
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(PAGE_WIDTH, y + 0.5)
    ctx.stroke()
  }
  ctx.strokeStyle = '#f1b5a4'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(MARGIN_X - 24, 0)
  ctx.lineTo(MARGIN_X - 24, PAGE_HEIGHT)
  ctx.stroke()
  ctx.restore()
}
