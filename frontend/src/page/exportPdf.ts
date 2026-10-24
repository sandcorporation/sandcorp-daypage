import type * as Y from 'yjs'
import { formatHourRange, formatShortDate, seqSuffix } from '../note/time'
import { exportFileName, renderPageCanvas, wrapLine } from './exportPng'
import { LINE_GAP, MARGIN_X, PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { DEFAULT_PAPER, paperPalette, type Paper } from './paper'

/**
 * 책(Book): 한 노트의 봉인된 페이지를 날짜순으로 엮은 PDF. 표지 한 장 뒤에 페이지가 한 장씩 들어가고,
 * 페이지마다 아래 발문에 날짜와 쪽수가 붙는다. 서버 도움 없이 브라우저에서 만든다.
 *
 * PDF는 외부 라이브러리 없이 직접 쓴다: 쪽마다 JPEG 그림 하나(DCTDecode)를 꽉 채워 놓는 가장 단순한 구조라
 * 글꼴을 심을 필요가 없다(표지 글도 캔버스에 그린다).
 */

/** 책의 한 장(기록 목록의 항목 + 그날 종이) */
export type BookPage = {
  key: string
  date: string
  seq: number
  openedAt: string
  closedAt: string
  paper: Paper
}

/** 책 한 장의 그림을 PDF에 넣을 때의 정보 */
export type PdfPage = {
  widthPt: number
  heightPt: number
  image: { width: number; height: number; jpeg: Uint8Array }
}

export type PdfMeta = { title: string; createdAt?: Date }

/** 장 좌표계 기준 발문(날짜·쪽수 줄) 높이 */
export const BOOK_FOOTER = LINE_GAP * 3
/** 책 한 쪽의 높이(장 좌표) */
export const BOOK_PAGE_HEIGHT = PAGE_HEIGHT + BOOK_FOOTER
/** 장 좌표 1 = 0.3pt. 1600×2496 → 480×748.8pt(약 17×26cm, 책 한 권 크기) */
export const PT_PER_UNIT = 0.3

const APP_PAPER = '#f7f6f1'
const INK = '#1f2128'
const MUTED = '#5e6270'
const ACCENT = '#2a47b0'
const LINE = '#d5d8e0'
const SANS = "'Gothic A1', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
const HAND = "'Nanum Pen Script', cursive"

/** 날짜·순번 순서(옛 장이 앞). 기록 목록은 최신이 위라 그대로 엮으면 책이 거꾸로 된다. */
export function comparePages(a: { date: string; seq: number }, b: { date: string; seq: number }): number {
  return a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1
}

export function bookOrder<T extends { date: string; seq: number }>(pages: T[]): T[] {
  return [...pages].sort(comparePages)
}

/** `2026년 10월 1일`. */
export function formatLongDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

/** 표지에 적는 기간. 하루면 그 날짜만, 여러 날이면 `첫날 – 마지막 날`. */
export function bookPeriod(firstDate: string, lastDate: string): string {
  if (firstDate === lastDate) return formatLongDate(firstDate)
  return `${formatLongDate(firstDate)} – ${formatLongDate(lastDate)}`
}

/** 한 쪽의 발문: 왼쪽은 날짜(같은 날 둘째 장이면 (2), 하루를 다 채우지 않았으면 시간 범위), 오른쪽은 쪽수. */
export function pageCaption(
  page: Pick<BookPage, 'date' | 'seq' | 'openedAt' | 'closedAt'>,
  index: number,
  total: number,
): { left: string; right: string } {
  const range = formatHourRange(page.openedAt, page.closedAt)
  const left = `${formatShortDate(page.date)}${seqSuffix(page.seq)}${range ? ` · ${range}` : ''}`
  return { left, right: `${index + 1} / ${total}` }
}

/** 책 파일 이름 `daypage-<노트 이름>-<첫날>~<마지막 날>.pdf`(하루면 그 날짜만). */
export function bookFileName(noteName: string, firstDate: string, lastDate: string): string {
  return exportFileName(noteName, firstDate === lastDate ? firstDate : `${firstDate}~${lastDate}`, 'pdf')
}

// ---------- PDF 쓰기(순수 함수) ----------

const ascii = (s: string) => new TextEncoder().encode(s)

/** PDF 문자열. 한글이 들어가므로 UTF-16BE(BOM 포함) 16진수 문자열로 쓴다. */
export function pdfTextString(s: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
  return `<${hex}>`
}

/** `D:20261023085300+09'00'` (KST). */
export function pdfDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600 * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `D:${p(kst.getUTCFullYear(), 4)}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}${p(kst.getUTCSeconds())}+09'00'`
}

const num = (n: number) => String(Math.round(n * 100) / 100)

/**
 * 쪽마다 JPEG 하나를 꽉 채운 PDF를 만든다.
 * 객체 번호: 1 카탈로그, 2 쪽 목록, 3 문서 정보, 그 뒤로 쪽마다 (쪽, 내용, 그림) 셋씩.
 */
export function buildPdf(pages: PdfPage[], meta: PdfMeta): Uint8Array {
  if (pages.length === 0) throw new Error('쪽이 없어요')
  const objects: Uint8Array[][] = [] // objects[i] = (i+1)번 객체의 본문 조각들
  const add = (parts: (string | Uint8Array)[]) => {
    objects.push(parts.map((p) => (typeof p === 'string' ? ascii(p) : p)))
    return objects.length
  }
  const firstPageObj = 4
  const pageObj = (i: number) => firstPageObj + i * 3
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')

  add(['<< /Type /Catalog /Pages 2 0 R >>'])
  add([`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`])
  add([
    `<< /Title ${pdfTextString(meta.title)} /Producer (Daypage) /CreationDate (${pdfDate(meta.createdAt ?? new Date())}) >>`,
  ])
  pages.forEach((page, i) => {
    const p = pageObj(i)
    add([
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.widthPt)} ${num(page.heightPt)}] ` +
        `/Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`,
    ])
    const content = `q ${num(page.widthPt)} 0 0 ${num(page.heightPt)} 0 0 cm /Im0 Do Q`
    add([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`])
    add([
      `<< /Type /XObject /Subtype /Image /Width ${page.image.width} /Height ${page.image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.jpeg.byteLength} >>\nstream\n`,
      page.image.jpeg,
      '\nendstream',
    ])
  })

  const chunks: Uint8Array[] = []
  let offset = 0
  const push = (c: Uint8Array) => {
    chunks.push(c)
    offset += c.byteLength
  }
  // 둘째 줄의 비ASCII 바이트 넷은 "이진 파일"이라는 관례적 표시. TextEncoder는 UTF-8로 바꾸므로 Latin-1 바이트로 직접 쓴다.
  push(latin1('%PDF-1.4\n%âãÏÓ\n'))

  const offsets: number[] = []
  objects.forEach((parts, i) => {
    offsets.push(offset)
    push(ascii(`${i + 1} 0 obj\n`))
    parts.forEach(push)
    push(ascii('\nendobj\n'))
  })
  const xref = offset
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) table += `${String(o).padStart(10, '0')} 00000 n \n`
  table += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  push(ascii(table))

  const out = new Uint8Array(offset)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

// ---------- 그리기(브라우저) ----------

export type CoverInfo = { noteName: string; period: string; pageCount: number; memberCount: number }

/** 표지: 노트 이름(손글씨), 기간, 장 수·참여 인원, 아래에 Daypage. */
export function paintCover(ctx: CanvasRenderingContext2D, pixelScale: number, cover: CoverInfo): void {
  ctx.save()
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
  ctx.fillStyle = APP_PAPER
  ctx.fillRect(0, 0, PAGE_WIDTH, BOOK_PAGE_HEIGHT)

  // 테두리 두 줄
  ctx.strokeStyle = LINE
  ctx.lineWidth = 3
  ctx.strokeRect(MARGIN_X, MARGIN_X, PAGE_WIDTH - MARGIN_X * 2, BOOK_PAGE_HEIGHT - MARGIN_X * 2)
  ctx.lineWidth = 1
  ctx.strokeRect(MARGIN_X + 14, MARGIN_X + 14, PAGE_WIDTH - (MARGIN_X + 14) * 2, BOOK_PAGE_HEIGHT - (MARGIN_X + 14) * 2)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = PAGE_WIDTH / 2

  // 제목: 폭에 맞춰 최대 세 줄
  const titleSize = 150
  ctx.font = `${titleSize}px ${HAND}`
  ctx.fillStyle = INK
  const title = cover.noteName.trim() || '이름 없는 노트'
  const lines = wrapLine(title, PAGE_WIDTH - MARGIN_X * 4, (s) => ctx.measureText(s).width).slice(0, 3)
  const titleTop = BOOK_PAGE_HEIGHT * 0.36 - ((lines.length - 1) * titleSize * 1.1) / 2
  lines.forEach((line, i) => ctx.fillText(line.trim(), cx, titleTop + i * titleSize * 1.1))
  let y = titleTop + (lines.length - 1) * titleSize * 1.1 + titleSize * 0.9

  // 짧은 강조 줄
  ctx.fillStyle = ACCENT
  ctx.fillRect(cx - 60, y, 120, 6)
  y += 90

  ctx.fillStyle = MUTED
  ctx.font = `600 44px ${SANS}`
  ctx.fillText(cover.period, cx, y)
  y += 76
  ctx.font = `400 36px ${SANS}`
  ctx.fillText(`${cover.pageCount}장 · 참여 ${cover.memberCount}명`, cx, y)

  ctx.fillStyle = ACCENT
  ctx.font = `64px ${HAND}`
  ctx.fillText('Daypage', cx, BOOK_PAGE_HEIGHT - MARGIN_X - 110)
  ctx.restore()
}

function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255
}

/** 봉인된 장 하나를 책 한 쪽으로: 종이 아래에 발문 띠를 붙이고 날짜·쪽수를 적는다. */
export async function renderBookPage(
  doc: Y.Doc,
  page: BookPage,
  index: number,
  total: number,
  pixelScale: number,
  photos?: string,
): Promise<HTMLCanvasElement> {
  const inner = await renderPageCanvas(doc, pixelScale, page.paper, photos)
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_WIDTH * pixelScale
  canvas.height = BOOK_PAGE_HEIGHT * pixelScale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas를 쓸 수 없어요')
  const palette = paperPalette(page.paper.color)
  ctx.fillStyle = palette.ground
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(inner, 0, 0)
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
  ctx.fillStyle = luma(palette.ground) > 0.5 ? MUTED : LINE
  ctx.font = `600 28px ${SANS}`
  ctx.textBaseline = 'middle'
  const { left, right } = pageCaption(page, index, total)
  const y = PAGE_HEIGHT + BOOK_FOOTER / 2
  ctx.textAlign = 'left'
  ctx.fillText(left, MARGIN_X, y)
  ctx.textAlign = 'right'
  ctx.fillText(right, PAGE_WIDTH - MARGIN_X, y)
  return canvas
}

async function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했어요'))), 'image/jpeg', quality),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

function toPdfPage(canvas: HTMLCanvasElement, jpeg: Uint8Array, pixelScale: number): PdfPage {
  return {
    widthPt: (canvas.width / pixelScale) * PT_PER_UNIT,
    heightPt: (canvas.height / pixelScale) * PT_PER_UNIT,
    image: { width: canvas.width, height: canvas.height, jpeg },
  }
}

export type BookSource = { page: BookPage; load: () => Promise<Y.Doc> }

export type BookOptions = {
  noteName: string
  memberCount: number
  /** 어떤 순서로 주어도 날짜순으로 엮는다 */
  pages: BookSource[]
  /** 사진 주소 앞부분(photoBase) */
  photos?: string
  /** 장을 하나 그릴 때마다(표지 제외) */
  onProgress?: (done: number, total: number) => void
  /** 장 좌표 1당 픽셀. 1.5면 2400×3744px(약 360dpi). 너무 크면 iPad의 캔버스 한계(약 1,670만 픽셀)를 넘는다 */
  pixelScale?: number
  /** JPEG 품질 0~1 */
  quality?: number
}

/** 노트의 봉인된 장들을 책 한 권(PDF)으로 엮는다. 장은 하나씩 받아 그리고 바로 JPEG로 굳혀 메모리를 아낀다. */
export async function renderNoteBook({
  noteName,
  memberCount,
  pages,
  photos,
  onProgress,
  pixelScale = 1.5,
  quality = 0.9,
}: BookOptions): Promise<Blob> {
  if (pages.length === 0) throw new Error('엮을 장이 없어요')
  const ordered = [...pages].sort((a, b) => comparePages(a.page, b.page))
  const total = ordered.length

  // 표지 글꼴은 글 상자에 쓰이지 않았으면 아직 안 받아 왔을 수 있다.
  try {
    await document.fonts?.load?.(`150px ${HAND}`)
    await document.fonts?.load?.(`600 44px ${SANS}`)
  } catch {
    // 글꼴을 못 받아도 기본 글꼴로 그린다
  }
  const coverCanvas = document.createElement('canvas')
  coverCanvas.width = PAGE_WIDTH * pixelScale
  coverCanvas.height = BOOK_PAGE_HEIGHT * pixelScale
  const cctx = coverCanvas.getContext('2d')
  if (!cctx) throw new Error('canvas를 쓸 수 없어요')
  paintCover(cctx, pixelScale, {
    noteName,
    period: bookPeriod(ordered[0].page.date, ordered[total - 1].page.date),
    pageCount: total,
    memberCount,
  })
  const pdfPages: PdfPage[] = [toPdfPage(coverCanvas, await canvasJpeg(coverCanvas, quality), pixelScale)]

  onProgress?.(0, total)
  for (let i = 0; i < total; i++) {
    const { page, load } = ordered[i]
    const doc = await load()
    const canvas = await renderBookPage(doc, { ...page, paper: page.paper ?? DEFAULT_PAPER }, i, total, pixelScale, photos)
    pdfPages.push(toPdfPage(canvas, await canvasJpeg(canvas, quality), pixelScale))
    doc.destroy()
    onProgress?.(i + 1, total)
  }
  const bytes = buildPdf(pdfPages, { title: noteName })
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
