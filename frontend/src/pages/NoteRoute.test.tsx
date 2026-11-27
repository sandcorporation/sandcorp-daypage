import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { NoteRoute } from './NoteRoute'

vi.mock('../auth/me', () => {
  const me = { authenticated: false }
  return { useMe: () => ({ me, error: false }) }
})

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

function open(preview: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => preview))
  render(
    <MemoryRouter initialEntries={['/note/n1']}>
      <Routes>
        <Route path="/note/:noteId" element={<NoteRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('로그인하지 않은 사람에게 닫힌 노트는 초대 대신 닫힘과 사유를 보인다', async () => {
  open(respond(403, { code: 'note_closed', detail: '운영 정책에 따라 닫힌 노트예요. 사유: 광고 글' }))
  expect(await screen.findByRole('heading', { name: '닫힌 노트예요' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('사유: 광고 글')
  expect(screen.queryByRole('link', { name: /카카오로 로그인/ })).not.toBeInTheDocument()
})

test('로그인하지 않은 사람에게 열린 노트는 초대를 보인다', async () => {
  open(respond(200, { name: '우리집', online: 2, isFull: false }))
  expect(await screen.findByRole('link', { name: /카카오로 로그인하고 참여하기/ })).toBeInTheDocument()
})
