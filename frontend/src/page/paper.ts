import type { CSSProperties } from 'react'
import { LINE_GAP, MARGIN_X, PAGE_HEIGHT, PAGE_WIDTH } from './geometry'

const LINE_GAP_FULL = LINE_GAP
const MARGIN_X_FULL = MARGIN_X

/** 노트 종이: 노트 전체 설정(참여자 누구나 바꾼다). 봉인한 장에는 그날 종이가 남는다(backend/daypage/paper.py). */
export type PaperPattern = 'lined' | 'grid' | 'dot' | 'blank'
/** 기본 종이 색 */
export type PaperPreset = 'white' | 'cream' | 'gray'
/** 기본 종이 색이거나 직접 고른 색 코드(#rrggbb, 소문자) */
export type PaperColor = PaperPreset | `#${string}`
export type Paper = { pattern: PaperPattern; margin: boolean; color: PaperColor }
type Palette = { name: string; ground: string; rule: string; dot: string; margin: string }

export const DEFAULT_PAPER: Paper = { pattern: 'lined', margin: true, color: 'white' }

export const PAPER_PATTERNS: { id: PaperPattern; name: string }[] = [
  { id: 'lined', name: '줄 노트' },
  { id: 'grid', name: '모눈' },
  { id: 'dot', name: '점' },
  { id: 'blank', name: '무지' },
]

/** 기본 종이 색마다 바탕·무늬·여백 선 색 */
export const PAPER_COLORS: Record<PaperPreset, Palette> = {
  white: { name: '흰 종이', ground: '#ffffff', rule: '#e9ecf2', dot: '#c3c8d3', margin: '#f1b5a4' },
  cream: { name: '미색 종이', ground: '#fbf5e6', rule: '#e6dcc4', dot: '#c9bfa6', margin: '#eeaa95' },
  gray: { name: '연회색 종이', ground: '#eef0f3', rule: '#dde1ea', dot: '#b8becb', margin: '#e9a898' },
}

const isPattern = (v: unknown): v is PaperPattern => PAPER_PATTERNS.some((p) => p.id === v)
const isPreset = (v: unknown): v is PaperPreset => typeof v === 'string' && Object.hasOwn(PAPER_COLORS, v)
export const isCustomPaperColor = (v: string): v is `#${string}` => /^#[0-9a-f]{6}$/.test(v)

function readColor(v: unknown): PaperColor {
  if (isPreset(v)) return v
  if (typeof v === 'string' && isCustomPaperColor(v.toLowerCase())) return v.toLowerCase() as `#${string}`
  return DEFAULT_PAPER.color
}

/** 두 색을 t(0~1)만큼 섞는다. */
function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16)
  const cb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t)
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`
}

/**
 * 종이 색의 바탕·무늬·여백 선 색. 직접 고른 색은 바탕에서 무늬 색을 만든다:
 * 밝은 바탕은 짙은 남색 쪽으로, 어두운 바탕은 흰색 쪽으로 조금씩 섞어 바탕과 어울리게 한다.
 */
export function paperPalette(color: PaperColor): Palette {
  if (isPreset(color)) return PAPER_COLORS[color]
  const n = parseInt(color.slice(1), 16)
  const luma = (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255
  const ink = luma > 0.5 ? '#1e2a4a' : '#ffffff'
  return {
    name: '직접 고른 색',
    ground: color,
    rule: mix(color, ink, luma > 0.5 ? 0.1 : 0.14),
    dot: mix(color, ink, luma > 0.5 ? 0.26 : 0.3),
    margin: mix(color, '#e0603f', luma > 0.5 ? 0.4 : 0.5),
  }
}

/** 서버·메시지에서 온 값. 모르는 값이나 빠진 항목은 기본값으로 채운다. */
export function normalizePaper(raw: unknown): Paper {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    pattern: isPattern(r.pattern) ? r.pattern : DEFAULT_PAPER.pattern,
    margin: typeof r.margin === 'boolean' ? r.margin : DEFAULT_PAPER.margin,
    color: readColor(r.color),
  }
}

/**
 * 화면 종이(장 좌표 크기의 층)에 쓰는 CSS 배경. 무늬 간격은 줄 간격(LINE_GAP)과 같다.
 * scale을 주면 그만큼 작게 그린다(종이 고르기의 미리보기 칸). 선 굵기는 1px 그대로라 작아도 보인다.
 */
export function paperStyle(paper: Paper, scale = 1): CSSProperties {
  const c = paperPalette(paper.color)
  const LINE_GAP = Math.round(LINE_GAP_FULL * scale)
  const MARGIN_X = MARGIN_X_FULL * scale
  const layers: { image: string; size: string; position: string }[] = []
  if (paper.margin) {
    const x = Math.round(MARGIN_X - 26 * scale)
    layers.push({
      image: `linear-gradient(90deg, transparent ${x}px, ${c.margin} ${x}px, ${c.margin} ${x + 2}px, transparent ${x + 2}px)`,
      size: '100% 100%',
      position: '0 0',
    })
  }
  if (paper.pattern === 'lined') {
    layers.push({ image: `linear-gradient(${c.rule} 1px, transparent 1px)`, size: `100% ${LINE_GAP}px`, position: `0 ${LINE_GAP - 1}px` })
  } else if (paper.pattern === 'grid') {
    layers.push({ image: `linear-gradient(${c.rule} 1px, transparent 1px)`, size: `${LINE_GAP}px ${LINE_GAP}px`, position: `0 ${LINE_GAP - 1}px` })
    layers.push({ image: `linear-gradient(90deg, ${c.rule} 1px, transparent 1px)`, size: `${LINE_GAP}px ${LINE_GAP}px`, position: `${LINE_GAP - 1}px 0` })
  } else if (paper.pattern === 'dot') {
    layers.push({
      image: `radial-gradient(circle, ${c.dot} ${Math.max(1, 1.6 * scale)}px, transparent ${Math.max(1.4, 2.2 * scale)}px)`,
      size: `${LINE_GAP}px ${LINE_GAP}px`,
      position: `${LINE_GAP / 2}px ${LINE_GAP / 2}px`,
    })
  }
  if (layers.length === 0) {
    return { backgroundColor: c.ground, backgroundImage: 'none', backgroundSize: undefined, backgroundPosition: undefined }
  }
  return {
    backgroundColor: c.ground,
    backgroundImage: layers.map((l) => l.image).join(', '),
    backgroundSize: layers.map((l) => l.size).join(', '),
    backgroundPosition: layers.map((l) => l.position).join(', '),
  }
}

/** 이미지 저장용 종이(캔버스). 화면 CSS 배경과 같은 모양으로 그린다. */
export function paintPaperOn(ctx: CanvasRenderingContext2D, pixelScale: number, paper: Paper = DEFAULT_PAPER): void {
  const c = paperPalette(paper.color)
  ctx.save()
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
  ctx.fillStyle = c.ground
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  ctx.strokeStyle = c.rule
  ctx.lineWidth = 1
  if (paper.pattern === 'lined' || paper.pattern === 'grid') {
    for (let y = LINE_GAP; y < PAGE_HEIGHT; y += LINE_GAP) {
      ctx.beginPath()
      ctx.moveTo(0, y - 0.5)
      ctx.lineTo(PAGE_WIDTH, y - 0.5)
      ctx.stroke()
    }
  }
  if (paper.pattern === 'grid') {
    for (let x = LINE_GAP; x < PAGE_WIDTH; x += LINE_GAP) {
      ctx.beginPath()
      ctx.moveTo(x - 0.5, 0)
      ctx.lineTo(x - 0.5, PAGE_HEIGHT)
      ctx.stroke()
    }
  }
  if (paper.pattern === 'dot') {
    ctx.fillStyle = c.dot
    for (let y = LINE_GAP / 2; y < PAGE_HEIGHT; y += LINE_GAP) {
      for (let x = LINE_GAP / 2; x < PAGE_WIDTH; x += LINE_GAP) {
        ctx.beginPath()
        ctx.arc(x + LINE_GAP / 2, y + LINE_GAP / 2, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  if (paper.margin) {
    ctx.strokeStyle = c.margin
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(MARGIN_X - 25, 0)
    ctx.lineTo(MARGIN_X - 25, PAGE_HEIGHT)
    ctx.stroke()
  }
  ctx.restore()
}
