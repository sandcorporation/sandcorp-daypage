import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuggestButton } from './SuggestButton'

function stubFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

test('건의를 적어 보내면 노트 id와 함께 보내고 고맙다고 알린다', async () => {
  const fetchMock = stubFetch(201, { id: 1 })
  render(<SuggestButton noteId="note-1" />)
  await userEvent.click(screen.getByRole('button', { name: '기능 건의' }))
  const dialog = screen.getByRole('dialog', { name: '기능 건의' })
  expect(dialog).toBeInTheDocument()
  const send = screen.getByRole('button', { name: '보내기' })
  expect(send).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox', { name: '건의 내용' }), '지우개 크기를 고르고 싶어요')
  await userEvent.click(send)
  await waitFor(() => expect(screen.getByText(/고마워요/)).toBeInTheDocument())
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('/api/suggestions')
  const body = JSON.parse(init.body as string)
  expect(body).toMatchObject({ text: '지우개 크기를 고르고 싶어요', noteId: 'note-1' })
})

test('보낼 때의 화면 상태와 기기 정보를 함께 보내고, 그렇다고 알린다', async () => {
  const fetchMock = stubFetch(201, { id: 1 })
  // 보내는 순간의 상태를 읽는다(창을 연 때가 아니라)
  let tool = 'pen'
  render(<SuggestButton noteId="note-1" context={() => ({ tool, fingerMoves: true })} />)
  await userEvent.click(screen.getByRole('button', { name: '기능 건의' }))
  expect(screen.getByRole('dialog', { name: '기능 건의' })).toHaveTextContent('화면 설정')
  await userEvent.type(screen.getByRole('textbox', { name: '건의 내용' }), '입력창이 안 떠요')
  tool = 'text'
  await userEvent.click(screen.getByRole('button', { name: '보내기' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  const { context } = JSON.parse(init.body as string)
  expect(context).toMatchObject({ tool: 'text', fingerMoves: true, userAgent: navigator.userAgent })
  expect(context.viewport).toMatch(/^\d+x\d+$/)
})

test('서버가 거절하면 이유를 보여 주고 쓴 글은 남겨 둔다', async () => {
  stubFetch(429, { code: 'too_many', detail: '오늘은 건의를 많이 남기셨어요. 내일 다시 보내 주세요.' })
  render(<SuggestButton noteId="note-1" />)
  await userEvent.click(screen.getByRole('button', { name: '기능 건의' }))
  await userEvent.type(screen.getByRole('textbox', { name: '건의 내용' }), '하나 더')
  await userEvent.click(screen.getByRole('button', { name: '보내기' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('내일 다시'))
  expect(screen.getByRole('textbox', { name: '건의 내용' })).toHaveValue('하나 더')
})
