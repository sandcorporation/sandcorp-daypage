import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
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

test('비로그인 사용자에게 카카오로 시작하기를 보여준다', async () => {
  mockApi(() => ({ authenticated: false, notes: [] }))
  renderHome()
  const link = await screen.findByRole('link', { name: /카카오로 시작하기/ })
  expect(link).toHaveAttribute('href', '/auth/kakao/login?next=%2F')
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
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
})
