import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

type Routes = Record<string, unknown>

function stubApi(routes: Routes) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(routes).find((k) => url === k || url.startsWith(k + '?'))
      const body = key ? routes[key] : {}
      return new Response(JSON.stringify(typeof body === 'function' ? body(url, init) : body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return calls
}

const STATS = {
  totals: { users: 259, notes: 133 },
  today: { date: '2026-10-19', signups: 7, notes: 3, visitors: 35 },
  daily: Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(6 + i).padStart(2, '0')}`, signups: i, notes: 1, activeNotes: 2, participants: 3 })),
  hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, signups: 0, notes: 0, lastVisits: h % 3 })),
  suggestions: { new: 2 },
  online: { connections: 9, users: 8, waiting: 0, capacity: 360 },
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

test('로그인하지 않았으면 카카오 로그인으로 보낸다', async () => {
  stubApi({ '/api/me': { authenticated: false, isStaff: false } })
  render(<App />)
  expect(await screen.findByRole('link', { name: '카카오로 로그인' })).toHaveAttribute('href', '/auth/kakao/login?next=/admin/')
})

test('운영자가 아니면 들어갈 수 없다', async () => {
  stubApi({ '/api/me': { authenticated: true, isStaff: false } })
  render(<App />)
  expect(await screen.findByRole('heading', { name: '권한 없음' })).toBeInTheDocument()
})

test('운영자는 현황을 본다: 숫자와 그래프', async () => {
  stubApi({ '/api/me': { authenticated: true, isStaff: true }, '/api/admin/stats': STATS })
  render(<App />)
  expect(await screen.findByText('지금 접속')).toBeInTheDocument()
  expect(screen.getByText('35')).toBeInTheDocument()
  expect(screen.getByText('누적 259명')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '새 노트' })).toBeInTheDocument()
  expect(screen.getAllByText('표로 보기').length).toBeGreaterThan(0)
})

test('건의에 함께 온 화면 상태를 펼쳐 볼 수 있다', async () => {
  window.location.hash = '#suggestions'
  stubApi({
    '/api/me': { authenticated: true, isStaff: true },
    '/api/admin/suggestions': [
      {
        id: 8,
        text: '입력창이 안 떠요',
        status: 'new',
        createdAt: '2026-10-26T07:37:00Z',
        userId: 3,
        noteId: 'n',
        noteName: '우리집',
        context: { tool: 'text', fingerMoves: true, layer: null },
      },
      { id: 7, text: '지우개 크기', status: 'new', createdAt: '2026-10-19T05:00:00Z', userId: 3, noteId: 'n', noteName: '우리집', context: {} },
    ],
  })
  render(<App />)
  expect(await screen.findByText('입력창이 안 떠요')).toBeInTheDocument()
  // 상태가 온 건의에만 보인다
  expect(screen.getAllByText('화면 상태')).toHaveLength(1)
  await userEvent.click(screen.getByText('화면 상태'))
  expect(screen.getByText('fingerMoves')).toBeInTheDocument()
  expect(screen.getByText('true')).toBeInTheDocument()
  expect(screen.getByText('null')).toBeInTheDocument()
})

test('건의함에서 상태를 바꾸면 저장하고, 거르는 상태에서 빠진 건의는 목록에서 사라진다', async () => {
  window.location.hash = '#suggestions'
  const calls = stubApi({
    '/api/me': { authenticated: true, isStaff: true },
    '/api/admin/suggestions': [{ id: 7, text: '지우개 크기', status: 'new', createdAt: '2026-10-19T05:00:00Z', userId: 3, noteId: 'n', noteName: '우리집' }],
    '/api/admin/suggestions/7': { id: 7, status: 'done' },
  })
  render(<App />)
  expect(await screen.findByText('지우개 크기')).toBeInTheDocument()
  expect(screen.getByText('노트 ‘우리집’')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'done')
  await waitFor(() => expect(screen.queryByText('지우개 크기')).not.toBeInTheDocument())
  const patch = calls.find((c) => c.url === '/api/admin/suggestions/7')!
  expect(patch.init?.method).toBe('PATCH')
  expect(JSON.parse(patch.init?.body as string)).toEqual({ status: 'done' })
})
