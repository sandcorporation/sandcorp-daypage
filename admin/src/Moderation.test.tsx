import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

type Handler = (url: string, init?: RequestInit) => unknown

function stubApi(routes: Record<string, unknown | Handler>) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const body = url in routes ? routes[url] : {}
      const value = typeof body === 'function' ? (body as Handler)(url, init) : body
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  return calls
}

const ME = { authenticated: true, isStaff: true }

const NOTE = {
  id: 'n1',
  name: '우리집 노트',
  createdAt: '2026-10-10T01:00:00Z',
  ownerId: 3,
  memberLimit: null,
  paper: {},
  closed: null,
  today: '2026-10-20',
  members: [
    { id: 11, userId: 3, nickname: '노란 감자', color: '#f2c230', joinedAt: '2026-10-10T01:00:00Z', lastVisitedAt: '2026-10-20T01:00:00Z' },
    { id: 12, userId: 4, nickname: '푸른 고래', color: '#2a47b0', joinedAt: '2026-10-11T01:00:00Z', lastVisitedAt: '2026-10-20T02:00:00Z' },
  ],
  pages: [{ date: '2026-10-19', participantCount: 2, strokeCount: 40, paper: null }],
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

test('노트 목록에서 노트를 열면 참여자·페이지와 읽기 전용 보기 링크가 보인다', async () => {
  window.location.hash = '#notes'
  stubApi({
    '/api/me': ME,
    '/api/admin/notes': [{ id: 'n1', name: '우리집 노트', createdAt: '2026-10-10T01:00:00Z', ownerId: 3, memberCount: 2, memberLimit: null, pageCount: 2, lastVisitedAt: null, todayBytes: 0, closed: false }],
    '/api/admin/notes/n1': NOTE,
  })
  render(<App />)
  await userEvent.click(await screen.findByRole('link', { name: '우리집 노트' }))
  expect(await screen.findByRole('heading', { name: '우리집 노트' })).toBeInTheDocument()
  expect(screen.getByText('푸른 고래')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '오늘 페이지 보기' })).toHaveAttribute('href', '/staff/notes/n1/2026-10-20')
  expect(screen.getByRole('link', { name: /10\/19/ })).toHaveAttribute('href', '/staff/notes/n1/2026-10-19')
})

test('노트를 닫으려면 사유를 적고, 닫힌 노트는 다시 열 수 있다', async () => {
  window.location.hash = '#notes/n1'
  let closed: { at: string; reason: string } | null = null
  const calls = stubApi({
    '/api/me': ME,
    '/api/admin/notes/n1': () => ({ ...NOTE, closed }),
    '/api/admin/notes/n1/close': (_url: string, init?: RequestInit) => {
      closed = { at: '2026-10-20T03:00:00Z', reason: JSON.parse(init!.body as string).reason }
      return { id: 'n1', closed }
    },
    '/api/admin/notes/n1/reopen': () => {
      closed = null
      return { id: 'n1', closed: null }
    },
  })
  render(<App />)
  const close = await screen.findByRole('button', { name: '노트 닫기' })
  expect(close).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox', { name: '닫는 사유' }), '광고 글 반복')
  await userEvent.click(close)
  expect(await screen.findByText(/닫힌 노트예요/)).toBeInTheDocument()
  expect(screen.getByText(/광고 글 반복/)).toBeInTheDocument()
  expect(calls.find((c) => c.url === '/api/admin/notes/n1/close')!.init?.method).toBe('POST')

  await userEvent.click(screen.getByRole('button', { name: '다시 열기' }))
  await waitFor(() => expect(screen.queryByText(/닫힌 노트예요/)).not.toBeInTheDocument())
})

test('사용자를 기간과 사유를 골라 정지하고 풀 수 있다', async () => {
  window.location.hash = '#users/4'
  let suspension: { until: string | null; reason: string } | null = null
  const calls = stubApi({
    '/api/me': ME,
    '/api/admin/users/4': () => ({
      id: 4,
      createdAt: '2026-10-11T01:00:00Z',
      isStaff: false,
      suspension,
      notes: [{ id: 'n1', name: '우리집 노트', nickname: '푸른 고래', isOwner: false, lastVisitedAt: '2026-10-20T02:00:00Z', closed: false }],
    }),
    '/api/admin/users/4/suspend': (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      suspension = { until: body.days === null ? null : '2026-10-27T03:00:00Z', reason: body.reason }
      return { id: 4, suspension }
    },
    '/api/admin/users/4/unsuspend': () => {
      suspension = null
      return { id: 4, suspension: null }
    },
  })
  render(<App />)
  expect(await screen.findByRole('heading', { name: '사용자 #4' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '우리집 노트' })).toHaveAttribute('href', '#notes/n1')

  await userEvent.click(screen.getByRole('radio', { name: '7일' }))
  await userEvent.type(screen.getByRole('textbox', { name: '정지 사유' }), '욕설')
  await userEvent.click(screen.getByRole('button', { name: '정지하기' }))
  expect(await screen.findByText(/^정지 중 ·/)).toBeInTheDocument()
  const sent = calls.find((c) => c.url === '/api/admin/users/4/suspend')!
  expect(JSON.parse(sent.init?.body as string)).toEqual({ days: 7, reason: '욕설' })

  await userEvent.click(screen.getByRole('button', { name: '정지 풀기' }))
  await waitFor(() => expect(screen.queryByText(/^정지 중 ·/)).not.toBeInTheDocument())
})

test('운영자 기록에 열람과 조치가 보인다', async () => {
  window.location.hash = '#logs'
  stubApi({
    '/api/me': ME,
    '/api/admin/logs': [
      { id: 2, at: '2026-10-20T03:00:00Z', staffId: 1, action: 'close_note', noteId: 'n1', noteName: '우리집 노트', targetUserId: null, detail: '광고' },
      { id: 1, at: '2026-10-20T02:59:00Z', staffId: 1, action: 'view_page', noteId: 'n1', noteName: '우리집 노트', targetUserId: null, detail: '2026-10-19' },
    ],
  })
  render(<App />)
  expect(await screen.findByText('노트 닫기')).toBeInTheDocument()
  expect(screen.getByText('페이지 열람')).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: '우리집 노트' })[0]).toHaveAttribute('href', '#notes/n1')
})
