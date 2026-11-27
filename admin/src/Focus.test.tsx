import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'

type Handler = (init?: RequestInit) => unknown

class Fail {
  readonly detail: string

  constructor(detail: string) {
    this.detail = detail
  }
}

function stubApi(routes: Record<string, unknown | Handler>) {
  const calls: { url: string; method: string; body?: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
      const route = url.split('?')[0]
      const body = route in routes ? routes[route] : {}
      const value = typeof body === 'function' ? await (body as Handler)(init) : body
      const failed = value instanceof Fail
      return new Response(JSON.stringify(value), { status: failed ? 400 : 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  return calls
}

const ME = { authenticated: true, isStaff: true }

const suggestion = (id: number, text: string) => ({
  id,
  text,
  status: 'new',
  createdAt: '2026-10-19T05:00:00Z',
  userId: 3,
  noteId: 'n',
  noteName: '우리집',
  context: {},
})

async function openSuggestions(routes: Record<string, unknown | Handler> = {}) {
  window.location.hash = '#suggestions'
  const calls = stubApi({
    '/api/me': ME,
    '/api/admin/suggestions': [suggestion(9, '첫째'), suggestion(8, '둘째'), suggestion(7, '셋째')],
    ...routes,
  })
  render(<App />)
  await screen.findByText('첫째')
  const card = (text: string) => screen.getByText(text).closest('li')!
  const select = (text: string) => card(text).querySelector('select')!
  const button = (text: string) => card(text).querySelector('button')!
  return { calls, card, select, button }
}

const patches = (calls: { method: string; body?: string }[]) => calls.filter((c) => c.method === 'PATCH')

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

test('상태 칸에서 값을 고르기만 해서는 저장하지 않는다', async () => {
  const { calls, select } = await openSuggestions()
  fireEvent.change(select('첫째'), { target: { value: 'reviewing' } })
  fireEvent.change(select('첫째'), { target: { value: 'done' } })
  expect(select('첫째')).toHaveValue('done')
  expect(patches(calls)).toHaveLength(0)
  expect(screen.getByText('첫째')).toBeInTheDocument()
})

test('「바꾸기」로 저장해 카드가 빠지면 다음 카드로 초점이 가고 결과를 읽어 준다', async () => {
  const { calls, card, select, button } = await openSuggestions()
  await userEvent.selectOptions(select('둘째'), 'done')
  await userEvent.click(button('둘째'))
  await waitFor(() => expect(screen.queryByText('둘째')).not.toBeInTheDocument())
  expect(JSON.parse(patches(calls)[0].body!)).toEqual({ status: 'done' })
  expect(document.activeElement).not.toBe(document.body)
  expect(card('셋째')).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent('상태를 반영함으로 바꿨어요')
})

test('상태 칸에서 Enter로 저장하고, 다음 카드가 없으면 목록 제목으로 초점이 간다', async () => {
  const { calls, select } = await openSuggestions()
  await userEvent.selectOptions(select('셋째'), 'reviewing')
  select('셋째').focus()
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(screen.queryByText('셋째')).not.toBeInTheDocument())
  expect(patches(calls)).toHaveLength(1)
  expect(document.activeElement).not.toBe(document.body)
  expect(screen.getByRole('heading', { name: '건의 목록' })).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent('상태를 검토 중으로 바꿨어요')
})

test('카드가 목록에 남으면 초점은 그 자리에 있다', async () => {
  const { select, button } = await openSuggestions()
  await userEvent.click(screen.getByRole('button', { name: '전체' }))
  await screen.findByText('첫째')
  await userEvent.selectOptions(select('첫째'), 'declined')
  await userEvent.click(button('첫째'))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('상태를 안 함으로 바꿨어요'))
  expect(button('첫째')).toHaveFocus()
  expect(select('첫째')).toHaveValue('declined')
})

test('상태를 저장하지 못하면 알리고, 카드와 초점은 그대로다', async () => {
  const { select, button } = await openSuggestions({ '/api/admin/suggestions/9': new Fail('저장 실패') })
  await userEvent.selectOptions(select('첫째'), 'done')
  await userEvent.click(button('첫째'))
  expect(await screen.findByRole('alert')).toHaveTextContent('바꾸지 못했어요: 저장 실패')
  expect(button('첫째')).toHaveFocus()
})

test('저장을 기다리는 동안 다른 곳으로 옮긴 초점은 빼앗지 않는다', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const { select, button } = await openSuggestions({ '/api/admin/suggestions/9': () => gate.then(() => ({})) })
  await userEvent.selectOptions(select('첫째'), 'done')
  await userEvent.click(button('첫째'))
  select('셋째').focus()
  release()
  await waitFor(() => expect(screen.queryByText('첫째')).not.toBeInTheDocument())
  expect(select('셋째')).toHaveFocus()
})

test('노트를 닫으면 「다시 열기」로, 다시 열면 상태 제목으로 초점이 가고 결과를 읽어 준다', async () => {
  window.location.hash = '#notes/n1'
  let closed: { at: string; reason: string } | null = null
  stubApi({
    '/api/me': ME,
    '/api/admin/notes/n1': () => ({
      id: 'n1',
      name: '우리집 노트',
      createdAt: '2026-10-10T01:00:00Z',
      ownerId: 3,
      memberLimit: null,
      paper: {},
      closed,
      openPage: '2026-10-20',
      sealHour: 0,
      members: [],
      pages: [],
    }),
    '/api/admin/notes/n1/close': () => {
      closed = { at: '2026-10-20T03:00:00Z', reason: '광고' }
      return {}
    },
    '/api/admin/notes/n1/reopen': () => {
      closed = null
      return {}
    },
  })
  render(<App />)
  await userEvent.type(await screen.findByRole('textbox', { name: '닫는 사유' }), '광고')
  await userEvent.click(screen.getByRole('button', { name: '노트 닫기' }))
  const reopen = await screen.findByRole('button', { name: '다시 열기' })
  await waitFor(() => expect(reopen).toHaveFocus())
  expect(document.activeElement).not.toBe(document.body)
  expect(screen.getByRole('status')).toHaveTextContent('노트를 닫았어요')

  await userEvent.click(reopen)
  await waitFor(() => expect(screen.getByRole('heading', { name: '노트 닫기' })).toHaveFocus())
  expect(document.activeElement).not.toBe(document.body)
  expect(screen.getByRole('status')).toHaveTextContent('노트를 다시 열었어요')
})

test('정지하면 「정지 풀기」로, 풀면 상태 제목으로 초점이 가고 결과를 읽어 준다', async () => {
  window.location.hash = '#users/4'
  let suspension: { until: string | null; reason: string } | null = null
  stubApi({
    '/api/me': ME,
    '/api/admin/users/4': () => ({ id: 4, createdAt: '2026-10-11T01:00:00Z', isStaff: false, suspension, notes: [] }),
    '/api/admin/users/4/suspend': () => {
      suspension = { until: null, reason: '욕설' }
      return {}
    },
    '/api/admin/users/4/unsuspend': () => {
      suspension = null
      return {}
    },
  })
  render(<App />)
  await userEvent.type(await screen.findByRole('textbox', { name: '정지 사유' }), '욕설')
  await userEvent.click(screen.getByRole('button', { name: '정지하기' }))
  const lift = await screen.findByRole('button', { name: '정지 풀기' })
  await waitFor(() => expect(lift).toHaveFocus())
  expect(document.activeElement).not.toBe(document.body)
  expect(screen.getByRole('status')).toHaveTextContent('이용을 정지했어요')

  await userEvent.click(lift)
  await waitFor(() => expect(screen.getByRole('heading', { name: '이용 정지' })).toHaveFocus())
  expect(document.activeElement).not.toBe(document.body)
  expect(screen.getByRole('status')).toHaveTextContent('정지를 풀었어요')
})

test('조치를 기다리는 동안 단추는 초점을 지키고, 거듭 눌러도 한 번만 보낸다', async () => {
  window.location.hash = '#users/4'
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const calls = stubApi({
    '/api/me': ME,
    '/api/admin/users/4': { id: 4, createdAt: '2026-10-11T01:00:00Z', isStaff: false, suspension: { until: null, reason: '욕설' }, notes: [] },
    '/api/admin/users/4/unsuspend': () => gate.then(() => new Fail('풀지 못함')),
  })
  render(<App />)
  const lift = await screen.findByRole('button', { name: '정지 풀기' })
  await userEvent.click(lift)
  expect(lift).toBeEnabled()
  expect(lift).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(lift)
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  release()
  expect(await screen.findByRole('alert')).toHaveTextContent('풀지 못함')
  expect(lift).toHaveFocus()
})
