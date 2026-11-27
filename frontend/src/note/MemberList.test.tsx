import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberList } from './MemberList'

type Call = { url: string; method: string }

function member(id: number, nickname: string, isOwner = false) {
  return { id, nickname, color: '#2a47b0', isOwner, lastVisitedAt: '2026-10-20T02:00:00Z' }
}

function mockServer({ others = [] as string[], failKick = false } = {}) {
  const calls: Call[] = []
  let members = [
    member(1, '노란 감자', true),
    member(2, '푸른 고래'),
    ...others.map((name, i) => member(3 + i, name)),
  ]
  let kicked: { id: number; nickname: string; at: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method })
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (method === 'GET') return json({ members, kicked })
    if (url.endsWith('/kick')) {
      if (failKick) return new Response(JSON.stringify({ detail: '안 돼요' }), { status: 400 })
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

const button = (name: string) => screen.getByRole('button', { name })

/** Tab으로 옮긴 것처럼 초점을 두고 Enter로 누른다 */
async function press(el: HTMLElement) {
  el.focus()
  await userEvent.keyboard('{Enter}')
}

test('확인 단계로 가면 초점이 「내보내기 확인」으로 가고, 취소하면 「○○ 내보내기」로 돌아온다', async () => {
  mockServer()
  render(<MemberList noteId="n1" />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  expect(button('내보내기 확인')).toHaveFocus()
  await press(button('취소'))
  expect(button('푸른 고래 내보내기')).toHaveFocus()
})

test.each(['확인 단추', 'body'])('초점이 %s에 있을 때 Esc는 확인 단계만 거둔다', async (where) => {
  const calls = mockServer()
  const onWindowKey = vi.fn()
  window.addEventListener('keydown', onWindowKey)
  render(<MemberList noteId="n1" />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  if (where === 'body') button('내보내기 확인').blur()
  onWindowKey.mockClear()

  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('button', { name: '내보내기 확인' })).not.toBeInTheDocument()
  expect(button('푸른 고래 내보내기')).toHaveFocus()
  // 팝오버를 닫는 window 듣개까지 가지 않는다
  expect(onWindowKey).not.toHaveBeenCalled()
  // 확인 단계가 아니면 Esc를 붙잡지 않는다
  await userEvent.keyboard('{Escape}')
  expect(onWindowKey).toHaveBeenCalledTimes(1)
  expect(calls.every((c) => c.method === 'GET')).toBe(true)
  window.removeEventListener('keydown', onWindowKey)
})

test('내보낸 뒤 초점은 목록의 다음 사람으로 간다', async () => {
  mockServer({ others: ['초록 여우'] })
  render(<MemberList noteId="n1" />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await press(button('내보내기 확인'))
  await screen.findByRole('button', { name: '푸른 고래 다시 허용' })
  expect(button('초록 여우 내보내기')).toHaveFocus()
})

test('다음 사람이 없으면 목록 제목으로, 다시 허용한 뒤에도 목록 제목으로 간다', async () => {
  mockServer()
  render(<MemberList noteId="n1" />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await press(button('내보내기 확인'))
  const allow = await screen.findByRole('button', { name: '푸른 고래 다시 허용' })
  expect(screen.getByText('참여자 1명')).toHaveFocus()

  await press(allow)
  await screen.findByText('내보낸 사람이 없어요.')
  expect(screen.getByText('참여자 1명')).toHaveFocus()
})

test('내보내기가 실패하면 초점은 「내보내기 확인」에 남는다', async () => {
  mockServer({ failKick: true })
  render(<MemberList noteId="n1" />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await press(button('내보내기 확인'))
  await screen.findByRole('alert')
  expect(button('내보내기 확인')).toHaveFocus()
})
