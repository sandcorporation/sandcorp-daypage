// @vitest-environment node
import {
  bookFileName,
  bookOrder,
  bookPeriod,
  buildPdf,
  isBookCancelled,
  renderNoteBook,
  pageCaption,
  pdfDate,
  pdfTextString,
  type PdfPage,
} from './exportPdf'

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes)

function fakePage(n: number): PdfPage {
  // 진짜 JPEG일 필요는 없다. 바이트가 그대로, 길이가 맞게 들어가는지만 본다.
  const jpeg = new Uint8Array([0xff, 0xd8, n, 0x00, 0xff, 0xd9])
  return { widthPt: 480, heightPt: 748.8, image: { width: 1600, height: 2496, jpeg } }
}

describe('PDF 쓰기', () => {
  test('쪽마다 그림 하나를 꽉 채운 PDF를 만들고, 교차 참조표가 객체 위치를 정확히 가리킨다', () => {
    const bytes = buildPdf([fakePage(1), fakePage(2)], { title: '우리 책', createdAt: new Date('2026-10-22T23:53:00Z') })
    const text = latin1(bytes)

    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.endsWith('%%EOF\n')).toBe(true)
    expect(text).toContain('/Type /Pages /Kids [4 0 R 7 0 R] /Count 2')
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2)
    expect(text).toContain('/MediaBox [0 0 480 748.8]')
    expect(text).toContain('q 480 0 0 748.8 0 0 cm /Im0 Do Q')
    expect(text).toContain('/Width 1600 /Height 2496 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 6')
    // 그림 바이트가 그대로 들어간다
    expect(text).toContain('stream\n\xff\xd8\x01\x00\xff\xd9\nendstream')
    // 제목은 UTF-16BE, 만든 날짜는 KST
    expect(text).toContain(`/Title ${pdfTextString('우리 책')}`)
    expect(text).toContain("/CreationDate (D:20261023085300+09'00')")

    // 교차 참조표: startxref가 xref를, 각 항목이 "n 0 obj"를 가리킨다
    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)![1])
    expect(text.slice(startxref, startxref + 4)).toBe('xref')
    const entries = text.slice(startxref).match(/^(\d{10}) 00000 n $/gm)!
    expect(entries).toHaveLength(9) // 카탈로그, 쪽 목록, 정보 + 쪽 2 × (쪽, 내용, 그림)
    entries.forEach((entry, i) => {
      const at = Number(entry.slice(0, 10))
      expect(text.slice(at, at + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
    })
    expect(text).toContain('trailer\n<< /Size 10 /Root 1 0 R /Info 3 0 R >>')
  })

  test('쪽이 없으면 만들지 않는다', () => {
    expect(() => buildPdf([], { title: 'x' })).toThrow()
  })

  test('PDF 문자열은 BOM 붙은 UTF-16BE 16진수로, 이모지(서로게이트 쌍)도 그대로', () => {
    expect(pdfTextString('책A')).toBe('<FEFFCC45' + '0041>')
    expect(pdfTextString('😀')).toBe('<FEFFD83DDE00>')
  })

  test('날짜는 KST로 쓴다', () => {
    expect(pdfDate(new Date('2026-01-01T00:00:00Z'))).toBe("D:20260101090000+09'00'")
  })
})

describe('책 엮기', () => {
  test('기록 목록(최신이 위)을 날짜·순번 순서로 돌려 옛 장이 앞에 온다', () => {
    const pages = [
      { key: '2026-10-21-2', date: '2026-10-21', seq: 2 },
      { key: '2026-10-22', date: '2026-10-22', seq: 1 },
      { key: '2026-10-21', date: '2026-10-21', seq: 1 },
      { key: '2026-10-01', date: '2026-10-01', seq: 1 },
    ]
    expect(bookOrder(pages).map((p) => p.key)).toEqual(['2026-10-01', '2026-10-21', '2026-10-21-2', '2026-10-22'])
  })

  test('표지 기간은 하루면 그 날짜만, 여러 날이면 첫날–마지막 날', () => {
    expect(bookPeriod('2026-10-21', '2026-10-21')).toBe('2026년 10월 21일')
    expect(bookPeriod('2026-09-30', '2026-10-21')).toBe('2026년 9월 30일 – 2026년 10월 21일')
  })

  test('발문에는 날짜(둘째 장이면 순번, 하루를 다 채우지 않았으면 시간 범위)와 쪽수가 들어간다', () => {
    const fullDay = { date: '2026-10-21', seq: 1, openedAt: '2026-10-21T00:00:00+09:00', closedAt: '2026-10-22T00:00:00+09:00' }
    expect(pageCaption(fullDay, 0, 12)).toEqual({ left: '10월 21일 (수)', right: '1 / 12' })
    const partial = { date: '2026-10-21', seq: 2, openedAt: '2026-10-21T11:00:00+09:00', closedAt: '2026-10-22T04:00:00+09:00' }
    expect(pageCaption(partial, 4, 12)).toEqual({ left: '10월 21일 (수) (2) · 11:00–04:00', right: '5 / 12' })
  })

  test('파일 이름에는 노트 이름과 기간이 들어간다', () => {
    expect(bookFileName('우리집/공용 노트', '2026-10-01', '2026-10-22')).toBe('daypage-우리집_공용 노트-2026-10-01~2026-10-22.pdf')
    expect(bookFileName('하루', '2026-10-01', '2026-10-01')).toBe('daypage-하루-2026-10-01.pdf')
  })
})

describe('책 엮기 취소', () => {
  test('이미 취소된 신호면 어떤 장도 받지 않고 AbortError로 멈춘다', async () => {
    const load = vi.fn()
    const page = { key: '2026-10-21', date: '2026-10-21', seq: 1, openedAt: '', closedAt: '', paper: { pattern: 'lined', margin: true, color: 'white' } } as const
    const abort = new AbortController()
    abort.abort()
    const err = await renderNoteBook({ noteName: '집', memberCount: 1, pages: [{ page, load }], signal: abort.signal }).catch((e) => e)
    expect(isBookCancelled(err)).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(isBookCancelled(new Error('boom'))).toBe(false)
  })
})
