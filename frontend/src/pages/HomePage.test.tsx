import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { ARRIVE_AT_TITLE } from '../components/useFocusOnArrival'
import { HomePage } from './HomePage'

type Handler = (url: string, init?: RequestInit) => unknown

function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init)
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/note/:id" element={<p>노트 화면</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

function mockMeStatus(status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status, headers: { 'Content-Type': 'application/json' } })))
}

test('/api/me가 500이면 문제가 생겼어요 화면을 보여준다', async () => {
  mockMeStatus(500)
  renderHome()
  expect(await screen.findByRole('heading', { name: '문제가 생겼어요' })).toBeInTheDocument()
})

test('/api/me가 401이면 공개 첫 화면을 보여준다', async () => {
  mockMeStatus(401)
  renderHome()
  expect(await screen.findByRole('link', { name: /카카오로 시작하기/ })).toBeInTheDocument()
})

test('/api/me를 기다리는 동안 불러오는 중을 알린다', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  renderHome()
  expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
})

test('비로그인 사용자에게 카카오로 시작하기를 보여준다', async () => {
  mockApi(() => ({ authenticated: false, notes: [] }))
  renderHome()
  const link = await screen.findByRole('link', { name: /카카오로 시작하기/ })
  expect(link).toHaveAttribute('href', '/auth/kakao/login?next=%2F')
})

test('비로그인 홈 하단에 Sandcorp 링크가 rel 없이 걸린다', async () => {
  mockApi(() => ({ authenticated: false, notes: [] }))
  renderHome()
  const link = await screen.findByRole('link', { name: 'Made by Sandcorp' })
  expect(link).toHaveAttribute('href', 'https://sandcorp.co.kr/?utm_source=daypage&utm_medium=footer')
  expect(link).not.toHaveAttribute('rel')
})

test('로그인 사용자는 참여한 노트 목록을 보고 내가 만든 노트를 구분한다', async () => {
  mockApi(() => ({
    authenticated: true,
    notes: [
      { id: 'a', name: '우리집 공용 노트', isOwner: true, memberCount: 3, memberLimit: null },
      { id: 'b', name: '스터디', isOwner: false, memberCount: 2, memberLimit: 4 },
    ],
  }))
  renderHome()
  expect(await screen.findByText('우리집 공용 노트')).toBeInTheDocument()
  expect(screen.getByText('참여 3명 · 내가 만듦')).toBeInTheDocument()
  expect(screen.getByText('참여 2 / 4명')).toBeInTheDocument()
})

test('새 노트를 만들면 그 노트로 이동한다', async () => {
  const fetchMock = mockApi((url) =>
    url === '/api/notes' ? { id: 'new123', url: 'x' } : { authenticated: true, notes: [] },
  )
  renderHome()
  await userEvent.type(await screen.findByLabelText('노트 이름'), '캠핑 준비')
  await userEvent.selectOptions(screen.getByLabelText(/정원/), '4')
  await userEvent.click(screen.getByRole('button', { name: '노트 만들기' }))
  expect(await screen.findByText('노트 화면')).toBeInTheDocument()
  const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/notes')!
  expect(JSON.parse(String(init?.body))).toEqual({ name: '캠핑 준비', memberLimit: 4 })
})

test('다른 화면에서 동작을 마치고 오면 제목에 초점을 둔다', async () => {
  mockApi(() => ({ authenticated: true, notes: [] }))
  render(
    <MemoryRouter initialEntries={[{ pathname: '/', ...ARRIVE_AT_TITLE }]}>
      <HomePage />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { level: 1, name: '새 노트 만들기' })).toHaveFocus()
})

test('내가 만든 노트만 지울 수 있고, 확인하면 지운 뒤 목록에서 사라진다', async () => {
  let notes = [
    { id: 'mine', name: '우리집 노트', isOwner: true, memberCount: 2, memberLimit: null },
    { id: 'theirs', name: '남의 노트', isOwner: false, memberCount: 3, memberLimit: null },
  ]
  const fetchMock = mockApi((url, init) => {
    if (url === '/api/notes/mine' && init?.method === 'DELETE') {
      notes = notes.filter((n) => n.id !== 'mine')
      return null
    }
    return { authenticated: true, notes }
  })
  renderHome()
  expect(await screen.findByText('우리집 노트')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '노트 삭제: 남의 노트' })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '노트 삭제: 우리집 노트' }))
  const dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent('되돌릴 수 없어요')
  expect(dialog).toHaveTextContent('참여자 1명') // 2명 중 나를 뺀 사람
  await userEvent.click(screen.getByRole('button', { name: '삭제' }))

  expect(fetchMock).toHaveBeenCalledWith('/api/notes/mine', expect.objectContaining({ method: 'DELETE' }))
  await waitFor(() => expect(screen.queryByText('우리집 노트')).not.toBeInTheDocument())
  expect(screen.getByText('남의 노트')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: '새 노트 만들기' })).toHaveFocus()
})

test('삭제 확인 창에서 취소하면 지우지 않는다', async () => {
  const fetchMock = mockApi(() => ({
    authenticated: true,
    notes: [{ id: 'mine', name: '우리집 노트', isOwner: true, memberCount: 1, memberLimit: null }],
  }))
  renderHome()
  await userEvent.click(await screen.findByRole('button', { name: '노트 삭제: 우리집 노트' }))
  await userEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '노트 삭제: 우리집 노트' })).toHaveFocus()
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
})

test('푸터에 개인정보·오류 기록 링크가 있다', async () => {
  mockApi(() => ({ authenticated: false, notes: [] }))
  renderHome()
  const link = await screen.findByRole('link', { name: '개인정보·오류 기록' })
  expect(link).toHaveAttribute('href', 'https://sandcorporation.github.io/privacy-and-terms/errors/')
  expect(link).toHaveAttribute('rel', 'noopener')
})

test('삭제가 운영 조치로 막히면 서버가 준 글을 보인다', async () => {
  const detail = '운영 정책에 따라 닫힌 노트예요. 사유: 광고 글'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(JSON.stringify({ code: 'note_closed', detail }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(
            JSON.stringify({
              authenticated: true,
              notes: [{ id: 'mine', name: '우리집 노트', isOwner: true, memberCount: 1, memberLimit: null }],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
    ),
  )
  renderHome()
  await userEvent.click(await screen.findByRole('button', { name: '노트 삭제: 우리집 노트' }))
  await userEvent.click(screen.getByRole('button', { name: '삭제' }))
  expect(await screen.findByText(detail)).toBeInTheDocument()
  expect(screen.getByText('우리집 노트')).toBeInTheDocument()
})

test('삭제가 거절되면 글이 확인 창 안에만 뜨고, 창을 닫으면 만들기 폼에 남지 않는다', async () => {
  const detail = '운영 정책에 따라 닫힌 노트예요. 사유: 광고 글'
  const notes = Array.from({ length: 20 }, (_, i) => ({
    id: `n${i}`,
    name: `노트 ${i}`,
    isOwner: true,
    memberCount: 1,
    memberLimit: null,
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(JSON.stringify({ code: 'note_closed', detail }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify({ authenticated: true, notes }), {
            headers: { 'Content-Type': 'application/json' },
          }),
    ),
  )
  renderHome()
  await userEvent.click(await screen.findByRole('button', { name: '노트 삭제: 노트 19' }))
  await userEvent.click(screen.getByRole('button', { name: '삭제' }))

  const dialog = screen.getByRole('alertdialog')
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(detail)
  expect(screen.getAllByText(detail)).toHaveLength(1)

  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
  expect(screen.queryByText(detail)).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '노트 삭제: 노트 0' }))
  expect(within(screen.getByRole('alertdialog')).queryByRole('alert')).not.toBeInTheDocument()
})

test('노트를 만드는 동안 단추는 초점을 지키고, 실패해도 초점이 남는다', async () => {
  let fail = () => {}
  const fetchMock = vi.fn((url: string) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/notes') return new Promise<Response>((resolve) => (fail = () => resolve(json({}, 500))))
    return Promise.resolve(json({ authenticated: true, notes: [] }))
  })
  vi.stubGlobal('fetch', fetchMock)
  renderHome()
  const button = await screen.findByRole('button', { name: '노트 만들기' })
  await userEvent.click(button)
  expect(button).not.toBeDisabled()
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveFocus()
  await userEvent.click(button)
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/notes')).toHaveLength(1)
  fail()
  expect(await screen.findByRole('alert')).toHaveTextContent('노트를 만들지 못했어요')
  expect(button).toHaveFocus()
})

test('로그아웃하면 첫 화면의 제목에 초점을 둔다', async () => {
  let loggedIn = true
  mockApi((url) => {
    if (url === '/auth/logout') loggedIn = false
    return { authenticated: loggedIn, notes: [] }
  })
  renderHome()
  await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
  expect(await screen.findByRole('link', { name: /카카오로 시작하기/ })).toBeInTheDocument()
  expect(document.activeElement).not.toBe(document.body)
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
})

test('노트를 지우면 어느 노트를 지웠는지 알린다', async () => {
  mockApi(() => ({ authenticated: true, notes: [{ id: 'n1', name: '우리집 노트', isOwner: true, memberCount: 1, memberLimit: null }] }))
  renderHome()
  await userEvent.click(await screen.findByRole('button', { name: '노트 삭제: 우리집 노트' }))
  await userEvent.click(screen.getByRole('button', { name: '삭제' }))
  expect(await screen.findByText('‘우리집 노트’ 노트를 지웠어요')).toHaveAttribute('role', 'status')
})

test('노트 화면에서 지우고 오면 알리고, 방문 기록에서는 알림을 지운다', async () => {
  mockApi(() => ({ authenticated: true, notes: [] }))
  const states: unknown[] = []
  function Spy() {
    states.push(useLocation().state)
    return null
  }
  render(
    <MemoryRouter initialEntries={[{ pathname: '/', state: { focusTitle: true, notice: '‘모임’ 노트를 지웠어요' } }]}>
      <HomePage />
      <Spy />
    </MemoryRouter>,
  )
  expect(await screen.findByText('‘모임’ 노트를 지웠어요')).toHaveAttribute('role', 'status')
  expect(screen.getByRole('heading', { name: '새 노트 만들기' })).toHaveFocus()
  expect(states.at(-1)).toEqual({ focusTitle: true })
})
