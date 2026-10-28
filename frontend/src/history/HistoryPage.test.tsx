import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as Y from 'yjs'
import { HistoryPage } from './HistoryPage'

vi.mock('../page/exportPdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../page/exportPdf')>()),
  renderNoteBook: vi.fn(async () => new Blob(['%PDF'], { type: 'application/pdf' })),
}))
vi.mock('../page/exportPng', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../page/exportPng')>()),
  downloadBlob: vi.fn(),
}))

import { renderNoteBook } from '../page/exportPdf'
import { downloadBlob } from '../page/exportPng'

const note = {
  id: 'n1',
  name: '우리집',
  url: '/note/n1',
  isOwner: false,
  page: { key: '2026-10-23', date: '2026-10-23', seq: 1, openedAt: '', dueAt: '' },
  sealHour: 0,
  serverNow: '',
  me: { nickname: '노란 펭귄', color: '#000' },
  online: 1,
  memberCount: 3,
  memberLimit: null,
  colors: [],
}
// 기록 목록은 최신이 위
const sealed = [
  { key: '2026-10-22', date: '2026-10-22', seq: 1, openedAt: '2026-10-22T00:00:00+09:00', closedAt: '2026-10-23T00:00:00+09:00', participantCount: 2, strokeCount: 5 },
  { key: '2026-10-20', date: '2026-10-20', seq: 1, openedAt: '2026-10-20T00:00:00+09:00', closedAt: '2026-10-21T00:00:00+09:00', participantCount: 1, strokeCount: 3 },
]

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const snapshot = () => new Response(Y.encodeStateAsUpdate(new Y.Doc()) as BodyInit, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })

// 오늘 장: 시험마다 내용(획이 있나)을 바꾼다
let todayHasStroke = false
const todayDoc = () => {
  const doc = new Y.Doc()
  if (todayHasStroke) doc.getMap('strokes').set('s1', new Y.Map())
  return new Response(Y.encodeStateAsUpdate(doc) as BodyInit, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
}

beforeEach(() => {
  todayHasStroke = false
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/notes/n1') return json(note)
      if (url === '/api/notes/n1/pages') return json(sealed)
      if (url === '/api/notes/n1/today') return todayDoc()
      if (/^\/api\/notes\/n1\/pages\/\d{4}-\d{2}-\d{2}$/.test(url)) return snapshot()
      return new Response('{}', { status: 404 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function open() {
  return render(
    <MemoryRouter initialEntries={['/note/n1/history']}>
      <Routes>
        <Route path="/note/:noteId/history" element={<HistoryPage />} />
        <Route path="/note/:noteId/history/:pageKey" element={<HistoryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('‘책으로 저장’은 지난 페이지를 모두 날짜순으로 엮은 PDF를 노트 이름·기간 파일 이름으로 내려받는다', async () => {
  open()
  const button = await screen.findByRole('button', { name: '책으로 저장 (PDF)' })
  await userEvent.click(button)

  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('daypage-우리집-2026-10-20~2026-10-22.pdf')

  const options = vi.mocked(renderNoteBook).mock.calls[0][0]
  expect(options.noteName).toBe('우리집')
  expect(options.memberCount).toBe(3)
  expect(options.pages.map((s) => s.page.key)).toEqual(['2026-10-20', '2026-10-22'])
  // 종이가 빠진 옛 기록도 기본 종이로 채운다
  expect(options.pages[0].page.paper).toEqual({ pattern: 'lined', margin: true, color: 'white' })
  // 장은 누르는 순간이 아니라 엮는 쪽이 하나씩 받아 간다
  const doc = await options.pages[1].load()
  expect(doc).toBeInstanceOf(Y.Doc)
  expect(fetch).toHaveBeenCalledWith('/api/notes/n1/pages/2026-10-22', expect.anything())
})

test('엮는 동안 버튼은 진행 상황을 보이고 눌리지 않으며, 실패하면 알린다', async () => {
  let progress: ((done: number, total: number) => void) | undefined
  vi.mocked(renderNoteBook).mockImplementationOnce(async (opts) => {
    progress = opts.onProgress
    progress?.(1, 2)
    throw new Error('boom')
  })
  open()
  await userEvent.click(await screen.findByRole('button', { name: '책으로 저장 (PDF)' }))
  expect(await screen.findByText('책을 만들지 못했어요')).toBeInTheDocument()
  expect(downloadBlob).not.toHaveBeenCalled()
  // 끝나면 다시 누를 수 있다
  expect(screen.getByRole('button', { name: '책으로 저장 (PDF)' })).toBeEnabled()
})

test('오늘 장에 내용이 있으면 지금 종이로 맨 뒤에 넣고, 파일 이름 기간에 오늘이 들어간다', async () => {
  todayHasStroke = true
  open()
  await userEvent.click(await screen.findByRole('button', { name: '책으로 저장 (PDF)' }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('daypage-우리집-2026-10-20~2026-10-23.pdf')
  const pages = vi.mocked(renderNoteBook).mock.calls[0][0].pages
  expect(pages.map((s) => s.page.key).sort()).toEqual(['2026-10-20', '2026-10-22', '2026-10-23'])
  const todayPage = pages.find((s) => s.page.key === '2026-10-23')!.page
  expect(todayPage.paper).toEqual({ pattern: 'lined', margin: true, color: 'white' })
})

test('오늘 장이 비어 있으면 건너뛴다', async () => {
  open()
  await userEvent.click(await screen.findByRole('button', { name: '책으로 저장 (PDF)' }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
  expect(vi.mocked(renderNoteBook).mock.calls[0][0].pages.map((s) => s.page.key)).not.toContain('2026-10-23')
})

test('엮는 중 ‘취소’를 누르면 신호가 오고, 내려받지 않고 알림 없이 처음 상태로 돌아오며, 다시 누르면 정상 동작한다', async () => {
  vi.mocked(renderNoteBook).mockImplementationOnce(
    (opts) =>
      new Promise((_, reject) => {
        opts.onProgress?.(1, 2)
        opts.signal?.addEventListener('abort', () => reject(new DOMException('취소', 'AbortError')))
      }),
  )
  open()
  await userEvent.click(await screen.findByRole('button', { name: '책으로 저장 (PDF)' }))
  expect(await screen.findByRole('button', { name: '엮는 중… 1/2' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '취소' }))

  expect(await screen.findByRole('button', { name: '책으로 저장 (PDF)' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument()
  expect(screen.queryByText('책을 만들지 못했어요')).not.toBeInTheDocument()
  expect(downloadBlob).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole('button', { name: '책으로 저장 (PDF)' }))
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
})
