import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberList } from './MemberList'

type Call = { url: string; method: string }

function mockServer() {
  const calls: Call[] = []
  let members = [
    { id: 1, nickname: '노란 감자', color: '#f2c230', isOwner: true, lastVisitedAt: '2026-10-20T01:00:00Z' },
    { id: 2, nickname: '푸른 고래', color: '#2a47b0', isOwner: false, lastVisitedAt: '2026-10-20T02:00:00Z' },
  ]
  let kicked: { id: number; nickname: string; at: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method })
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (method === 'GET') return json({ members, kicked })
    if (url.endsWith('/kick')) {
      const id = Number(url.split('/').at(-2))
      const m = members.find((x) => x.id === id)!
      members = members.filter((x) => x.id !== id)
      kicked = [{ id: 9, nickname: m.nickname, at: '2026-10-20T03:00:00Z' }]
      return json({ ok: true })
    }
    kicked = []
    return new Response(null, { status: 204 })
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

test('참여자를 내보내기 전에 한 번 더 묻고, 내보낸 사람은 아래 목록에서 다시 허용한다', async () => {
  const calls = mockServer()
  render(<MemberList noteId="n1" />)
  expect(await screen.findByText('푸른 고래')).toBeInTheDocument()
  // 만든 사람은 내보낼 수 없다
  expect(screen.getAllByRole('button', { name: /내보내기/ })).toHaveLength(1)

  await userEvent.click(screen.getByRole('button', { name: '푸른 고래 내보내기' }))
  expect(calls.some((c) => c.method === 'POST')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: '내보내기 확인' }))
  expect(calls.at(-2)).toEqual({ url: '/api/notes/n1/members/2/kick', method: 'POST' })

  const allow = await screen.findByRole('button', { name: '푸른 고래 다시 허용' })
  await userEvent.click(allow)
  expect(calls.some((c) => c.url === '/api/notes/n1/kicked/9' && c.method === 'DELETE')).toBe(true)
  expect(await screen.findByText('내보낸 사람이 없어요.')).toBeInTheDocument()
})

test('내보내기를 취소하면 아무것도 보내지 않는다', async () => {
  const calls = mockServer()
  render(<MemberList noteId="n1" />)
  await userEvent.click(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await userEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(calls.every((c) => c.method === 'GET')).toBe(true)
  expect(screen.getByRole('button', { name: '푸른 고래 내보내기' })).toBeInTheDocument()
})
