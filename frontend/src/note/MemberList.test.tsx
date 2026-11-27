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
      // 첫 번째로 내보낸 사람의 번호는 9
      kicked = [...kicked, { id: 9 + kicked.length, nickname: m.nickname, at: '2026-10-20T03:00:00Z' }]
      return json({ ok: true })
    }
    kicked = kicked.filter((k) => k.id !== Number(url.split('/').at(-1)))
    return new Response(null, { status: 204 })
  })
  /** 다른 사람이 들어오거나 나간 것처럼 서버의 목록만 바꾼다 */
  const change = (next: (now: typeof members) => typeof members) => {
    members = next(members)
  }
  return Object.assign(calls, { change })
}

afterEach(() => vi.unstubAllGlobals())

test('참여자를 내보내기 전에 한 번 더 묻고, 내보낸 사람은 아래 목록에서 다시 허용한다', async () => {
  const calls = mockServer()
  render(<MemberList noteId="n1" memberCount={2} onNotice={() => {}} />)
  expect(await screen.findByText('푸른 고래')).toBeInTheDocument()
  // 만든 사람은 내보낼 수 없다
  expect(screen.getAllByRole('button', { name: /내보내기/ })).toHaveLength(1)

  await userEvent.click(screen.getByRole('button', { name: '푸른 고래 내보내기' }))
  expect(calls.some((c) => c.method === 'POST')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: '푸른 고래 내보내기 확인' }))
  expect(calls.at(-2)).toEqual({ url: '/api/notes/n1/members/2/kick', method: 'POST' })

  const allow = await screen.findByRole('button', { name: '푸른 고래 다시 허용' })
  await userEvent.click(allow)
  expect(calls.some((c) => c.url === '/api/notes/n1/kicked/9' && c.method === 'DELETE')).toBe(true)
  expect(await screen.findByText('내보낸 사람이 없어요.')).toBeInTheDocument()
})

test('내보내기를 취소하면 아무것도 보내지 않는다', async () => {
  const calls = mockServer()
  render(<MemberList noteId="n1" memberCount={2} onNotice={() => {}} />)
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
  render(<MemberList noteId="n1" memberCount={2} onNotice={() => {}} />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  expect(button('푸른 고래 내보내기 확인')).toHaveFocus()
  await press(button('취소'))
  expect(button('푸른 고래 내보내기')).toHaveFocus()
})

test.each(['확인 단추', 'body'])('초점이 %s에 있을 때 Esc는 확인 단계만 거둔다', async (where) => {
  const calls = mockServer()
  const onWindowKey = vi.fn()
  window.addEventListener('keydown', onWindowKey)
  render(<MemberList noteId="n1" memberCount={2} onNotice={() => {}} />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  if (where === 'body') button('푸른 고래 내보내기 확인').blur()
  onWindowKey.mockClear()

  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('button', { name: '푸른 고래 내보내기 확인' })).not.toBeInTheDocument()
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
  render(<MemberList noteId="n1" memberCount={2} onNotice={() => {}} />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await press(button('푸른 고래 내보내기 확인'))
  await screen.findByRole('button', { name: '푸른 고래 다시 허용' })
  expect(button('초록 여우 내보내기')).toHaveFocus()
})

test('다음 사람이 없으면 목록 제목으로, 다시 허용한 뒤에는 「내보낸 사람」 제목으로 간다', async () => {
  mockServer()
  render(<MemberList noteId="n1" memberCount={2} onNotice={() => {}} />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await press(button('푸른 고래 내보내기 확인'))
  const allow = await screen.findByRole('button', { name: '푸른 고래 다시 허용' })
  expect(screen.getByText('참여자 1명')).toHaveFocus()

  await press(allow)
  await screen.findByText('내보낸 사람이 없어요.')
  expect(screen.getByText('내보낸 사람')).toHaveFocus()
})

// 다시 허용은 확인 단계가 없어, 초점이 다음 「다시 허용」으로 가면 Enter 두 번에 두 사람을 허용한다(#197)
test('다시 허용한 뒤 초점은 다른 「다시 허용」 단추에 가지 않아, Enter를 또 눌러도 한 사람만 허용한다', async () => {
  const calls = mockServer({ others: ['초록 여우'] })
  render(<MemberList noteId="n1" memberCount={3} onNotice={() => {}} />)
  for (const name of ['푸른 고래', '초록 여우']) {
    await press(await screen.findByRole('button', { name: `${name} 내보내기` }))
    await press(button(`${name} 내보내기 확인`))
    await screen.findByRole('button', { name: `${name} 다시 허용` })
  }

  await press(button('푸른 고래 다시 허용'))
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: '푸른 고래 다시 허용' })).not.toBeInTheDocument())
  expect(screen.getByText('내보낸 사람')).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  expect(button('초록 여우 다시 허용')).toBeInTheDocument()
})

test('내보내기가 실패하면 초점은 「내보내기 확인」에 남는다', async () => {
  mockServer({ failKick: true })
  render(<MemberList noteId="n1" memberCount={2} onNotice={() => {}} />)
  await press(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await press(button('푸른 고래 내보내기 확인'))
  await screen.findByRole('alert')
  expect(button('푸른 고래 내보내기 확인')).toHaveFocus()
})

const list = (memberCount: number, onNotice: (text: string) => void = () => {}) => (
  <MemberList noteId="n1" memberCount={memberCount} onNotice={onNotice} />
)

test('참여 수가 바뀌면 목록을 다시 읽는다', async () => {
  const server = mockServer()
  const view = render(list(2))
  await screen.findByText('참여자 2명')
  server.change((now) => [...now, member(3, '초록 여우')])
  view.rerender(list(3))
  expect(await screen.findByText('참여자 3명')).toBeInTheDocument()
  expect(screen.getByText('초록 여우')).toBeInTheDocument()
})

test.each(['내보내기', '확인'])('「%s」 단추에 초점을 둔 사이 그 사람이 나가면 초점은 목록 제목으로 간다', async (step) => {
  const server = mockServer()
  const view = render(list(2))
  const kick = await screen.findByRole('button', { name: '푸른 고래 내보내기' })
  if (step === '확인') await press(kick)
  else kick.focus()
  server.change((now) => now.filter((m) => m.id !== 2))
  view.rerender(list(1))
  expect(await screen.findByText('참여자 1명')).toHaveFocus()
  expect(screen.queryByText(/내보내면 바로 나가고/)).not.toBeInTheDocument()
})

test('내보내기·다시 허용에 성공하면 누구에게 한 일인지 알린다', async () => {
  mockServer()
  const onNotice = vi.fn()
  render(list(2, onNotice))
  await userEvent.click(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await userEvent.click(button('푸른 고래 내보내기 확인'))
  await userEvent.click(await screen.findByRole('button', { name: '푸른 고래 다시 허용' }))
  await screen.findByText('내보낸 사람이 없어요.')
  expect(onNotice.mock.calls).toEqual([['푸른 고래님을 내보냈어요'], ['푸른 고래님을 다시 허용했어요']])
})

test('내보내기에 실패하면 성공 알림이 없다', async () => {
  mockServer({ failKick: true })
  const onNotice = vi.fn()
  render(list(2, onNotice))
  await userEvent.click(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  await userEvent.click(button('푸른 고래 내보내기 확인'))
  await screen.findByRole('alert')
  expect(onNotice).not.toHaveBeenCalled()
})

test('확인 단추는 대상을 이름에 담고 설명 문단과 이어진다', async () => {
  mockServer()
  render(list(2))
  await userEvent.click(await screen.findByRole('button', { name: '푸른 고래 내보내기' }))
  expect(button('푸른 고래 내보내기 확인')).toHaveAccessibleDescription(/다시 허용할 때까지/)
})
