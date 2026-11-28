import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { FakeProvider } from '../test/fakeProvider'
import { CHECK_AFTER_MS } from './unsent'
import { SILENT_AFTER_MS } from './useRealtime'
import { ARRIVE_AT_TITLE, type ArrivalState } from '../components/useFocusOnArrival'
import { NotePage } from './NotePage'
import type * as Y from 'yjs'
import { addStroke, addTextBox, readTextBoxes } from '../page/doc'
import type { NoteDetail } from './types'
import { DEFAULT_KEYMAP, resetKeymapStore, setKeymap } from '../page/shortcuts'

vi.mock('y-websocket', async () => ({ WebsocketProvider: (await import('../test/fakeProvider')).FakeProvider }))

const NOTE: NoteDetail = {
  id: 'n1',
  name: '우리 노트',
  url: 'http://localhost/note/n1',
  isOwner: false,
  page: { key: '2026-10-15', date: '2026-10-15', seq: 1, openedAt: '2026-10-15T00:00:00+09:00', dueAt: '2026-10-16T00:00:00+09:00' },
  sealHour: 0,
  serverNow: '2026-10-15T15:00:00+09:00',
  me: { nickname: '말랑한 고양이', color: '#E5484D' },
  online: 0,
  memberCount: 2,
  memberLimit: null,
  colors: [],
}

function latest() {
  return FakeProvider.instances[FakeProvider.instances.length - 1]
}

function renderNote() {
  render(
    <MemoryRouter>
      <NotePage initial={NOTE} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  FakeProvider.instances = []
  // jsdom에는 ResizeObserver가 없다(지면이 크기를 잴 때 쓴다).
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => vi.unstubAllGlobals())

test('노트를 만들고 오면 새 화면의 제목에 초점을 둔다', () => {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/note/n1', ...ARRIVE_AT_TITLE }]}>
      <NotePage initial={NOTE} />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 1, name: '우리 노트' })).toHaveFocus()
})

test('링크로 들어오면 제목이 초점을 가져가지 않는다', () => {
  renderNote()
  expect(screen.getByRole('heading', { level: 1, name: '우리 노트' })).not.toHaveFocus()
})

test('수용 인원이 차면 대기 화면에서 순번을 보고, 차례가 오면 노트가 열린다', async () => {
  renderNote()
  act(() => latest().receive(101, { type: 'queued', position: 3 }))
  expect(screen.getByRole('status')).toHaveTextContent('지금 3번째')
  act(() => latest().receive(101, { type: 'queued', position: 2 }))
  expect(screen.getByRole('status')).toHaveTextContent('지금 2번째')
  act(() => latest().emit('sync', [true]))
  expect(screen.queryByText(/잠시 기다려 주세요/)).not.toBeInTheDocument()
  expect(screen.getByText('우리 노트')).toBeInTheDocument()
})

test('대기열까지 가득 차면 잠시 후 다시 화면을 보이고, 다시 시도는 새로 접속한다', async () => {
  renderNote()
  const first = latest()
  act(() => first.emit('connection-close', [{ code: 4430 }]))
  expect(first.shouldConnect).toBe(false)
  expect(screen.getByText(/사람이 너무 많아요/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(latest()).not.toBe(first)
  expect(screen.queryByText(/사람이 너무 많아요/)).not.toBeInTheDocument()
})

test('자리를 비워 내보내지면 자동으로 다시 붙지 않고, 다시 들어가기는 새로 접속한다', async () => {
  renderNote()
  const first = latest()
  act(() => first.emit('connection-close', [{ code: 4408 }]))
  expect(first.shouldConnect).toBe(false)
  expect(screen.getByText(/자리를 비워 나갔어요/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '다시 들어가기' }))
  expect(latest()).not.toBe(first)
  expect(screen.queryByText(/자리를 비워 나갔어요/)).not.toBeInTheDocument()
  expect(document.activeElement).not.toBe(document.body)
  expect(screen.getByRole('heading', { level: 1, name: NOTE.name })).toHaveFocus()
})

test('노트 색이 바뀌었다는 알림(102)을 받으면 도구 막대가 바로 바뀐다', async () => {
  renderNote()
  act(() => latest().receive(102, { type: 'note_colors', colors: ['#16794f'] }))
  await userEvent.click(screen.getByRole('button', { name: /^잉크:/ }))
  expect(screen.getByRole('button', { name: '노트 색 #16794f' })).toBeInTheDocument()
})

test('노트 머리말 알림(105)을 받으면 이름과 참여 수가 바로 바뀐다', async () => {
  renderNote()
  expect(screen.getByText('참여 2명')).toBeInTheDocument()
  act(() => latest().receive(105, { type: 'note_info', name: '바뀐 이름', memberCount: 3, memberLimit: 4 }))
  expect(screen.getByText('바뀐 이름')).toBeInTheDocument()
  expect(screen.queryByText('우리 노트')).not.toBeInTheDocument()
  expect(screen.getByText('참여 3 / 4명')).toBeInTheDocument()
})

// 동시에 들어오면 먼저 읽은 수가 늦게 도착할 수 있다. 판이 더 작은 알림은 버린다(#222).
test('머리말 알림(105)이 거꾸로 와도 판이 큰 값이 남는다', () => {
  renderNote()
  act(() => latest().receive(105, { type: 'note_info', name: NOTE.name, memberCount: 4, memberLimit: 8, seq: 12 }))
  act(() => latest().receive(105, { type: 'note_info', name: NOTE.name, memberCount: 3, memberLimit: 8, seq: 11 }))
  expect(screen.getByText('참여 4 / 8명')).toBeInTheDocument()
  act(() => latest().receive(105, { type: 'note_info', name: NOTE.name, memberCount: 5, memberLimit: 8, seq: 13 }))
  expect(screen.getByText('참여 5 / 8명')).toBeInTheDocument()
})

// 다시 허용은 참여 수가 그대로라, 알림이 온 것만으로 다시 읽어야 한다(#197)
test('참여자 창을 열어 둔 사이 알림(105)이 오면 참여 수가 같아도 목록을 다시 읽는다', async () => {
  let kicked = [{ id: 9, nickname: '푸른 고래', at: '2026-10-20T03:00:00Z' }]
  vi.stubGlobal('fetch', async (url: string) =>
    new Response(JSON.stringify(url.endsWith('/members') ? { members: [], kicked } : {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  render(
    <MemoryRouter>
      <NotePage initial={{ ...NOTE, isOwner: true }} />
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByRole('button', { name: /^참여 / }))
  expect(await screen.findByRole('button', { name: '푸른 고래 다시 허용' })).toBeInTheDocument()
  kicked = []
  act(() => latest().receive(105, { type: 'note_info', name: NOTE.name, memberCount: 2, memberLimit: null }))
  expect(await screen.findByText('내보낸 사람이 없어요.')).toBeInTheDocument()
})

test('고르고 있던 노트 색이 빠지면 기본 잉크로 돌아간다', async () => {
  renderNote()
  act(() => latest().receive(102, { type: 'note_colors', colors: ['#16794f'] }))
  await userEvent.click(screen.getByRole('button', { name: /^잉크:/ }))
  await userEvent.click(screen.getByRole('button', { name: '노트 색 #16794f' }))
  expect(screen.getByRole('button', { name: '잉크: 노트 색 #16794f' })).toBeInTheDocument()
  act(() => latest().receive(102, { type: 'note_colors', colors: [] }))
  expect(screen.getByRole('button', { name: '잉크: 잉크 파랑' })).toBeInTheDocument()
})

test('운영자가 노트를 닫으면 다시 붙지 않고, 서버가 알려 준 사유와 함께 닫힌 노트 안내를 보인다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ code: 'note_closed', detail: '운영 정책에 따라 닫힌 노트예요. 사유: 광고 글' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  renderNote()
  const first = latest()
  act(() => first.emit('connection-close', [{ code: 4410 }]))
  expect(first.shouldConnect).toBe(false)
  expect(screen.getByRole('heading', { name: '닫힌 노트예요' })).toBeInTheDocument()
  expect(await screen.findByText(/사유: 광고 글/)).toBeInTheDocument()
})

test('내보내지거나 정지되면 다시 붙지 않고 그 안내를 보인다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
  renderNote()
  act(() => latest().emit('connection-close', [{ code: 4411 }]))
  expect(screen.getByRole('heading', { name: '이 노트에 들어갈 수 없어요' })).toBeInTheDocument()
})

test('끊긴 까닭을 물었는데 이유 없는 403이면 화면의 설명을 그대로 둔다', async () => {
  const request = vi.fn(async () => new Response('<h1>Forbidden</h1>', { status: 403 }))
  vi.stubGlobal('fetch', request)
  renderNote()
  await act(async () => latest().emit('connection-close', [{ code: 4411 }]))
  expect(request).toHaveBeenCalled()
  expect(screen.getByText('노트를 만든 사람이 이 노트에서 내보냈어요.')).toBeInTheDocument()
  expect(screen.queryByText('요청을 처리하지 못했어요.')).not.toBeInTheDocument()
})

test('집중 모드를 켜면 머리글·아래 칩이 숨고 전체 화면을 시도하며, Esc로 나온다', async () => {
  const request = vi.fn(async () => {})
  Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true })
  renderNote()
  expect(screen.getByRole('button', { name: '링크 공유' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '집중 모드', pressed: false }))
  expect(request).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '집중 모드', pressed: true })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '링크 공유' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '새 소식' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '확대' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: '링크 공유' })).toBeInTheDocument()
})

describe('남은 빈 글 상자 정리', () => {
  beforeEach(() => {
    localStorage.clear()
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
    vi.useFakeTimers()
  })
  afterEach(() => void vi.useRealTimers())

  const sync = (synced: boolean) => act(() => latest().emit('sync', [synced]))
  const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  const boxIds = () => readTextBoxes(latest().awareness.doc as Y.Doc).map((b) => b.id)
  const leftover = (id: string) =>
    act(() => addTextBox(latest().awareness.doc as Y.Doc, { id, x: 0, y: 320, width: 200, color: '#000', font: 'gothic', fontSize: 18, author: NOTE.me.nickname }))

  /** 글씨 도구로 지면을 눌러 빈 상자를 만들고 초점을 둔다. 새 상자의 id를 돌려준다. */
  async function writeEmptyBox() {
    const before = boxIds()
    fireEvent.click(screen.getByRole('button', { name: '글씨' }))
    const frame = document.querySelector('.page-frame') as HTMLElement
    const at = { pointerId: 1, pointerType: 'mouse', clientX: 120, clientY: 100, button: 0 }
    fireEvent.pointerDown(frame, { ...at, buttons: 1 })
    fireEvent.pointerUp(frame, at)
    await wait(100)
    expect(document.activeElement).toHaveAttribute('aria-label', '글 상자')
    return boxIds().filter((id) => !before.includes(id))[0]
  }

  test('들어와 동기화가 끝나면 지난번에 비워 둔 내 빈 상자를 지운다', async () => {
    renderNote()
    leftover('old')
    sync(true)
    await wait(1_600)
    expect(boxIds()).toEqual([])
  })

  test('들어와 정리하기 전에 만들어 고치고 있는 빈 상자는 남긴다', async () => {
    renderNote()
    leftover('old')
    sync(true)
    const mine = await writeEmptyBox()
    await wait(1_600)
    expect(boxIds()).toEqual([mine])
  })

  test('빈 상자를 고치는 중에 끊겼다 이어져도 상자가 남는다', async () => {
    renderNote()
    sync(true)
    await wait(1_600)
    const mine = await writeEmptyBox()
    sync(false)
    sync(true)
    await wait(1_600)
    expect(boxIds()).toEqual([mine])
    expect(document.activeElement).toHaveAttribute('aria-label', '글 상자')
  })

  test('들어와 정리하기 전에 끊기면 다시 이어졌을 때 정리한다', async () => {
    renderNote()
    leftover('old')
    sync(true)
    await wait(500)
    sync(false)
    sync(true)
    await wait(1_600)
    expect(boxIds()).toEqual([])
  })
})

describe('손가락·화면 고정', () => {
  beforeEach(() => {
    localStorage.clear()
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  })
  const frame = () => document.querySelector('.page-frame') as HTMLElement
  const touch = (type: 'pointerDown' | 'pointerUp', id: number, x: number) =>
    fireEvent[type](frame(), { pointerId: id, pointerType: 'touch', clientX: x, clientY: 100, button: 0, buttons: 1 })

  test('두 손가락 탭은 되돌리기, 세 손가락 탭은 다시하기', async () => {
    renderNote()
    act(() => latest().emit('sync', [true]))
    const strokes = () => latest().awareness.doc.getMap('strokes').size
    fireEvent.pointerDown(frame(), { pointerId: 9, pointerType: 'mouse', clientX: 50, clientY: 50, button: 0, buttons: 1 })
    fireEvent.pointerMove(frame(), { pointerId: 9, pointerType: 'mouse', clientX: 90, clientY: 90, buttons: 1 })
    fireEvent.pointerUp(frame(), { pointerId: 9, pointerType: 'mouse', clientX: 90, clientY: 90 })
    expect(strokes()).toBe(1)

    touch('pointerDown', 1, 100)
    touch('pointerDown', 2, 200)
    touch('pointerUp', 1, 100)
    touch('pointerUp', 2, 200)
    expect(strokes()).toBe(0)

    touch('pointerDown', 1, 100)
    touch('pointerDown', 2, 200)
    touch('pointerDown', 3, 300)
    touch('pointerUp', 1, 100)
    touch('pointerUp', 2, 200)
    touch('pointerUp', 3, 300)
    expect(strokes()).toBe(1)
  })

  test('글씨 도구로 손가락 탭하면 그 탭 처리 중에 입력 칸에 포커스가 가 휴대폰 키보드가 뜬다(앱 안 브라우저)', async () => {
    renderNote()
    act(() => latest().emit('sync', [true]))
    await userEvent.click(screen.getByRole('button', { name: '글씨' }))
    // 앱 안 브라우저(WKWebView 등)는 터치 이벤트 처리 중에 받은 포커스에만 키보드를 띄운다.
    let focusedDuringTap: Element | null = null
    const record = () => (focusedDuringTap = document.activeElement)
    window.addEventListener('pointerdown', record)
    touch('pointerDown', 1, 120)
    window.removeEventListener('pointerdown', record)
    touch('pointerUp', 1, 120)
    expect(focusedDuringTap).toBeInstanceOf(HTMLInputElement)
    // 편집기가 그려지면 포커스는 글 상자로 넘어간다.
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', '글 상자'))
  })

  test('화면 고정·손 버튼은 누르면 켜지고 알리며, 이 브라우저에 기억한다', async () => {
    renderNote()
    const lock = screen.getByRole('button', { name: '화면 고정' })
    expect(lock).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(lock)
    expect(lock).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/화면을 고정했어요/)).toBeInTheDocument()
    expect(document.querySelector<HTMLElement>('.page-viewport')!.style.overflow).toBe('hidden')

    const hand = screen.getByRole('button', { name: '손가락으로 화면 옮기기' })
    await userEvent.click(hand)
    expect(hand).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(localStorage.getItem('daypage:tool-prefs')!)).toMatchObject({ viewLock: true, penOnly: 'on' })
  })
})

test('건의를 보내면 지금 도구·펜 전용 모드 같은 화면 상태가 함께 간다(설정 실수를 가려내려고)', async () => {
  localStorage.clear()
  const fetchMock = vi.fn(async () => new Response('{"id":1}', { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  renderNote()
  act(() => latest().emit('sync', [true]))
  await userEvent.click(screen.getByRole('button', { name: '글씨' }))
  await userEvent.click(screen.getByRole('button', { name: '손가락으로 화면 옮기기' }))
  await userEvent.click(screen.getByRole('button', { name: '기능 건의' }))
  await userEvent.type(screen.getByRole('textbox', { name: '건의 내용' }), '입력창이 안 떠요')
  await userEvent.click(screen.getByRole('button', { name: '보내기' }))
  await waitFor(() => expect(screen.getByText(/고마워요/)).toBeInTheDocument())
  const call = fetchMock.mock.calls.find((c) => String((c as unknown[])[0]) === '/api/suggestions') as unknown as [string, RequestInit]
  const { context } = JSON.parse(call[1].body as string)
  expect(context).toMatchObject({ tool: 'text', fingerMoves: true, penOnly: 'on', viewLock: false, synced: true })
})

test('만든 사람에게만 새 페이지 시각 버튼이 보이고, 봉인 예정이 바뀌었다는 알림에 카운트다운이 바뀐다', () => {
  render(
    <MemoryRouter>
      <NotePage initial={{ ...NOTE, isOwner: true }} />
    </MemoryRouter>,
  )
  act(() => latest().emit('sync', [true]))
  expect(screen.getByRole('button', { name: '새 페이지 00:00' })).toBeInTheDocument()
  // 서버 시각 15:00, 봉인 예정 다음 날 00:00 → 약 9시간
  expect(screen.getByText(/새 페이지까지 0[89]:/)).toBeInTheDocument()
  act(() => latest().receive(104, { type: 'note_page', key: '2026-10-15', dueAt: '2026-10-15T18:00:00+09:00', sealHour: 18 }))
  expect(screen.getByText(/새 페이지까지 0[23]:/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '새 페이지 18:00' })).toBeInTheDocument()
})

const stroke = (doc: Y.Doc) =>
  addStroke(doc, { id: 's1', tool: 'pen', color: '#000000', width: 2, points: [0, 0, 0.5, 10, 10, 0.5], author: '말랑한 고양이', createdAt: 0 })
/** 만들고 아무것도 쓰지 않은 글 상자. 서버는 보관할 때 지운다 */
const blankBox = (doc: Y.Doc) => addTextBox(doc, { id: 't1', x: 0, y: 0, width: 200, color: '#000000', fontSize: 20, author: '말랑한 고양이' })

test.each([
  { name: '그린 장 보관', moved: true, draw: stroke, message: '새 페이지가 열리는 시각을 12:00로 바꿨어요. 지금 페이지를 기록으로 옮겼어요' },
  { name: '빈 장 보관', moved: true, draw: blankBox, message: '새 페이지가 열리는 시각을 12:00로 바꿨어요. 빈 페이지라 기록에는 남지 않아요' },
  { name: '보관 없음', moved: false, draw: stroke, message: '새 페이지가 열리는 시각을 12:00로 바꿨어요' },
])('새 페이지 시각을 저장한 알림은 지금 장의 보관 결과를 함께 말한다: $name', async ({ moved, draw, message }) => {
  const page = moved ? { ...NOTE.page, key: '2026-10-15-2', seq: 2 } : NOTE.page
  const patch = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/notes/n1' || init?.method !== 'PATCH') return new Response('{}', { status: 404 })
      patch(init.body)
      return Response.json({ sealHour: 12, page })
    }),
  )
  render(
    <MemoryRouter>
      <NotePage initial={{ ...NOTE, isOwner: true }} />
    </MemoryRouter>,
  )
  act(() => latest().emit('sync', [true]))
  act(() => draw(latest().awareness.doc))
  await userEvent.click(screen.getByRole('button', { name: '새 페이지 00:00' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '새 페이지 시각' }), '12')
  expect(patch).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText(message)).toHaveAttribute('role', 'status')
  // 낭독기가 두 번 읽지 않게, 이 저장을 말하는 live 영역은 하나다
  expect(screen.getAllByRole('status').filter((el) => el.textContent?.includes('바꿨어요'))).toHaveLength(1)
  expect(screen.getByRole('button', { name: '새 페이지 12:00' })).toHaveFocus()
  expect(patch).toHaveBeenCalledExactlyOnceWith('{"sealHour":12}')
})

test('참여자에게는 새 페이지 시각 버튼이 없다', () => {
  renderNote()
  act(() => latest().emit('sync', [true]))
  expect(screen.queryByRole('button', { name: /^새 페이지 d/ })).not.toBeInTheDocument()
})

describe('단축키', () => {
  // 계정 단축키(/api/me/shortcuts). 시험마다 서버가 줄 값과 받은 요청을 둔다.
  let account: unknown
  let saveOk: boolean
  let puts: unknown[]
  beforeEach(() => {
    resetKeymapStore()
    localStorage.clear()
    account = {}
    saveOk = true
    puts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
        if (url === '/api/me/shortcuts' && init?.method === 'PUT') {
          puts.push(JSON.parse(init.body as string))
          return saveOk ? json(puts[puts.length - 1]) : json({ detail: 'x' }, 500)
        }
        if (url === '/api/me/shortcuts') return json(account)
        return json({}, 404)
      }),
    )
  })

  test('글자 키로 도구를 바꾸고, 글을 쓰는 중에는 단축키가 쉰다', async () => {
    renderNote()
    await userEvent.keyboard('e')
    expect(screen.getByRole('button', { name: '지우개' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('p')
    expect(screen.getByRole('button', { name: /^펜/ })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: '기능 건의' }))
    await userEvent.type(screen.getByRole('textbox', { name: '건의 내용' }), 'e')
    expect(screen.getByRole('button', { name: /^펜/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('단축키 창에서 키를 바꾸면 새 키로 동작하고, 다른 동작이 쓰던 키는 옮겨 왔다고 알린다', async () => {
    renderNote()
    await userEvent.keyboard('{Shift>}[Slash]{/Shift}')
    expect(screen.getByRole('dialog', { name: '단축키' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '지우개 단축키 바꾸기: E' }))
    expect(screen.getByText('새 키를 누르세요')).toBeInTheDocument()
    await userEvent.keyboard('p')
    expect(screen.getByText('P를 ‘펜’에서 빼서 ‘지우개’에 붙였어요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '펜 단축키 바꾸기: 없음' })).toBeInTheDocument()
    // 이 브라우저에 기억한다
    expect(JSON.parse(localStorage.getItem('daypage:shortcuts')!)).toEqual({ eraser: ['P'], pen: [] })

    // Esc는 새 키 받기를 그만두기만 하고 창은 닫지 않는다
    await userEvent.click(screen.getByRole('button', { name: '펜 단축키 바꾸기: 없음' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '단축키' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '단축키' })).not.toBeInTheDocument()

    await userEvent.keyboard('p')
    expect(screen.getByRole('button', { name: '지우개' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('e')
    expect(screen.getByRole('button', { name: '지우개' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('도구 막대 풍선 도움말에 지금 단축키가 보인다', async () => {
    setKeymap({ ...DEFAULT_KEYMAP, undo: ['U'], eraser: [] })
    renderNote()
    expect(screen.getByRole('button', { name: '되돌리기' })).toHaveAttribute('title', '되돌리기 (U)')
    expect(screen.getByRole('button', { name: '글씨' })).toHaveAttribute('title', '글씨 (T)')
    expect(screen.getByRole('button', { name: '지우개' })).toHaveAttribute('title', '지우개')
  })

  test('다른 기기에서 바꿔 계정에 저장된 단축키를 노트를 열 때 받아 쓴다', async () => {
    account = { eraser: ['P'], pen: [] }
    renderNote()
    await waitFor(() => expect(screen.getByRole('button', { name: '지우개' })).toHaveAttribute('title', '지우개 (P)'))
    await userEvent.keyboard('p')
    expect(screen.getByRole('button', { name: '지우개' })).toHaveAttribute('aria-pressed', 'true')
    // 이 브라우저에도 사본을 둔다
    expect(JSON.parse(localStorage.getItem('daypage:shortcuts')!)).toEqual({ eraser: ['P'], pen: [] })
  })

  test('바꾼 단축키는 계정에 저장하고, 저장하지 못하면 알린다', async () => {
    renderNote()
    await userEvent.keyboard('{Shift>}[Slash]{/Shift}')
    await userEvent.click(screen.getByRole('button', { name: '집중 모드 단축키 바꾸기: F' }))
    await userEvent.keyboard('g')
    await waitFor(() => expect(puts).toEqual([{ focus: ['G'] }]))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    saveOk = false
    await userEvent.click(screen.getByRole('button', { name: '집중 모드 기본값으로' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('계정에 저장하지 못했어요')
    expect(puts).toEqual([{ focus: ['G'] }, {}])
  })
})

describe('성공한 쓰기 알림', () => {
  function respond(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  test('참여자 창에서 노트를 지우면 홈에 지운 노트 이름을 넘긴다', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'DELETE') return new Response(null, { status: 204 })
      return respond(url.endsWith('/members') ? { members: [], kicked: [] } : {})
    })
    function Home() {
      return <p>{(useLocation().state as ArrivalState)?.notice}</p>
    }
    render(
      <MemoryRouter initialEntries={['/note/n1']}>
        <Routes>
          <Route path="/note/n1" element={<NotePage initial={{ ...NOTE, isOwner: true }} />} />
          <Route path="/" element={<Home />} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: /^참여 / }))
    await userEvent.click(screen.getByRole('button', { name: '이 노트 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(await screen.findByText('‘우리 노트’ 노트를 지웠어요')).toBeInTheDocument()
  })

  test.each([
    ['성공', 200, '노트 이름을 바꿨어요: 새 이름'],
    ['실패', 500, '서버에 문제가 생겨 하지 못했어요. 잠시 뒤 다시 해 주세요.'],
  ])('이름 바꾸기 %s를 알린다', async (_, status, text) => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) =>
      init.method === 'PATCH' ? respond({ name: '새 이름' }, status) : respond({}),
    )
    render(
      <MemoryRouter>
        <NotePage initial={{ ...NOTE, isOwner: true }} />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: '노트 이름 바꾸기: 우리 노트' }))
    const input = screen.getByRole('textbox', { name: '노트 이름' })
    await userEvent.clear(input)
    await userEvent.type(input, '새 이름{Enter}')
    expect(await screen.findByText(text)).toHaveAttribute('role', 'status')
  })
})

// 새 장으로 바뀌면 빈 종이만 남지 않게 알린다(#208)
describe('새 페이지 알림', () => {
  const NOTICE = '새 페이지가 열렸어요. 지난 페이지는 기록에서 볼 수 있어요'
  const SAVED = '새 페이지가 열리는 시각을 02:00로 바꿨어요. 빈 페이지라 기록에는 남지 않아요'
  const NEXT: NoteDetail = {
    ...NOTE,
    page: { key: '2026-10-15-2', date: '2026-10-15', seq: 2, openedAt: '2026-10-15T15:00:00+09:00', dueAt: '2026-10-16T02:00:00+09:00' },
  }
  const roll = () => act(() => latest().receive(100, { type: 'page_rolled', key: NEXT.page.key }))
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const statuses = () => screen.queryAllByRole('status').map((el) => el.textContent ?? '')
  const heard = (text: string) => statuses().filter((t) => t.includes(text))

  beforeEach(() => sessionStorage.clear())

  const connect = () =>
    act(() => {
      latest().emit('status', [{ status: 'connected' }])
      latest().emit('sync', [true])
    })
  const pill = () => document.querySelector('.connection-pill .pill-long')?.textContent
  const LIVE = '실시간 연결됨 · 자동 저장'
  const DOWN = '연결이 끊겼어요 · 다시 연결하는 중…'
  /** y-websocket이 닫을 때의 순서 */
  const drop = (code: number, p = latest()) =>
    act(() => {
      p.emit('connection-close', [{ code }])
      p.emit('sync', [false])
      p.emit('status', [{ status: 'disconnected' }])
    })

  test('page_rolled로 장이 바뀌면 live 영역에는 새 페이지 알림 하나만 나간다(#212)', async () => {
    vi.stubGlobal('fetch', async (url: string) => json(url === '/api/notes/n1' ? { ...NEXT, sealHour: 2 } : {}))
    renderNote()
    connect()
    const said: string[] = []
    const last = new Map<Element, string>()
    const regions = () => document.querySelectorAll('[role="status"], [aria-live]')
    regions().forEach((el) => last.set(el, el.textContent ?? ''))
    const watcher = new MutationObserver(() => {
      for (const el of regions()) {
        const text = el.textContent ?? ''
        if (text !== (last.get(el) ?? '') && text) said.push(text)
        last.set(el, text)
      }
    })
    watcher.observe(document.body, { subtree: true, childList: true, characterData: true })
    const before = latest()
    await act(async () => before.receive(100, { type: 'page_rolled', key: NEXT.page.key }))
    drop(4409, before)
    await waitFor(() => expect(latest()).not.toBe(before))
    await act(async () => latest().emit('status', [{ status: 'connecting' }]))
    await act(async () => latest().emit('status', [{ status: 'connected' }]))
    await act(async () => latest().emit('sync', [true]))
    await waitFor(() => expect(said).toEqual([NOTICE]))
    expect(pill()).toBe(LIVE)
    expect(screen.queryByRole('button', { name: '기록 보기' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '기록' })).toHaveAttribute('href', '/note/n1/history')
    watcher.disconnect()
    // 새 장에서 진짜로 끊기면 지금처럼 알린다
    drop(1006)
    expect(pill()).toBe(DOWN)
  })

  test.each([
    ['새 장에 붙다가 끊김', () => drop(1006), DOWN],
    ['네트워크 끊김', () => act(() => void window.dispatchEvent(new Event('offline'))), '오프라인 · 이 탭에서 다시 연결되면 맞춰져요'],
  ])('교체 중의 진짜 실패는 숨기지 않는다: %s', async (_, fail, text) => {
    vi.stubGlobal('fetch', async (url: string) => json(url === '/api/notes/n1' ? NEXT : {}))
    renderNote()
    connect()
    const before = latest()
    roll()
    drop(4409, before)
    expect(pill()).toBe(LIVE)
    await waitFor(() => expect(latest()).not.toBe(before))
    fail()
    expect(pill()).toBe(text)
  })

  test.each([
    ['서버의 장이 그대로', async () => json(NOTE)],
    ['새 장을 읽지 못함', async () => Promise.reject(new TypeError('offline'))],
  ])('닫힌 뒤 새 장을 얻지 못하면 끊김을 보인다: %s', async (_, read) => {
    vi.stubGlobal('fetch', (url: string) => (url === '/api/notes/n1' ? read() : Promise.resolve(json({}))))
    renderNote()
    connect()
    drop(4409)
    await waitFor(() => expect(pill()).toBe(DOWN))
  })

  test('교체가 오래 걸리면 지금 연결 상태를 보인다', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', async (url: string) => json(url === '/api/notes/n1' ? NEXT : {}))
      renderNote()
      connect()
      await act(async () => latest().receive(100, { type: 'page_rolled', key: NEXT.page.key }))
      expect(pill()).toBe(LIVE)
      await act(() => vi.advanceTimersByTimeAsync(10_000))
      expect(pill()).toBe('연결하는 중…')
    } finally {
      vi.useRealTimers()
    }
  })

  test('저장소를 막은 브라우저에서도 노트가 열린다', () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      renderNote()
      expect(screen.getByRole('heading', { level: 1, name: NOTE.name })).toBeInTheDocument()
    } finally {
      blocked.mockRestore()
    }
  })

  test('제 시각이 되면 서버 알림이 없어도 알린다', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', async (url: string) => json(url === '/api/notes/n1' ? NEXT : {}))
      render(
        <MemoryRouter>
          <NotePage initial={{ ...NOTE, page: { ...NOTE.page, dueAt: new Date(Date.now() + 1000).toISOString() }, serverNow: new Date().toISOString() }} />
        </MemoryRouter>,
      )
      expect(heard(NOTICE)).toHaveLength(0)
      await act(() => vi.advanceTimersByTimeAsync(5000))
      expect(heard(NOTICE)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([
    ['새 장 읽기가 저장 응답보다 먼저', true],
    ['저장 응답이 새 장 읽기보다 먼저', false],
  ])('바로 보관한 주인은 저장 결과만 듣는다: %s', async (_, readFirst) => {
    let answerPatch = () => {}
    let answerRead = () => {}
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (init.method === 'PATCH')
        return new Promise<Response>((r) => (answerPatch = () => r(json({ sealHour: 2, page: NEXT.page }))))
      if (url === '/api/notes/n1') return new Promise<Response>((r) => (answerRead = () => r(json({ ...NEXT, isOwner: true, sealHour: 2 }))))
      return Promise.resolve(json({}))
    })
    render(
      <MemoryRouter>
        <NotePage initial={{ ...NOTE, isOwner: true }} />
      </MemoryRouter>,
    )
    const everHeard: string[] = []
    const watcher = new MutationObserver(() => everHeard.push(...heard(NOTICE)))
    watcher.observe(document.body, { subtree: true, childList: true, characterData: true })
    connect()
    await userEvent.click(screen.getByRole('button', { name: /^새 페이지 \d/ }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '새 페이지 시각' }), '2')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    const before = latest()
    roll() // 서버는 저장 요청을 처리하는 동안 보낸다
    for (const answer of readFirst ? [() => answerRead(), () => answerPatch()] : [() => answerPatch(), () => answerRead()]) {
      await act(async () => answer())
    }
    await waitFor(() => expect(latest()).not.toBe(before))
    expect(heard(SAVED)).toHaveLength(1)
    expect(everHeard).toEqual([])
    watcher.disconnect()
  })

  test('새 버전 때문에 새로고침해도 다시 연 화면에서 알린다', async () => {
    sessionStorage.setItem('daypage:rolledFrom:n1', NOTE.page.key)
    render(
      <MemoryRouter>
        <NotePage initial={NEXT} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(heard(NOTICE)).toHaveLength(1))
    expect(sessionStorage.getItem('daypage:rolledFrom:n1')).toBeNull()
  })

  test('같은 장으로 다시 열면 알리지 않는다', () => {
    sessionStorage.setItem('daypage:rolledFrom:n1', NOTE.page.key)
    renderNote()
    expect(heard(NOTICE)).toHaveLength(0)
  })
})

// #250 끊긴 채 그린 것이 있으면 탭을 떠나기 전에 묻는다. 막힘 화면에서는 묻지 않는다.
describe('떠나기 전 확인', () => {
  const leaving = () => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  }
  const live = () =>
    act(() => {
      latest().emit('status', [{ status: 'connected' }])
      latest().emit('sync', [true])
    })
  const offline = () => act(() => void window.dispatchEvent(new Event('offline')))
  const draw = () => act(() => void stroke(latest().doc))
  /** 그리고 서버가 받았다고 답할 때까지(#258) */
  const drawAndConfirm = () => {
    vi.useFakeTimers()
    draw()
    act(() => void vi.advanceTimersByTime(CHECK_AFTER_MS))
    act(() => latest().answerChecks())
    vi.useRealTimers()
  }

  beforeEach(() => vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 })))
  afterEach(() => void vi.useRealTimers())

  test('오프라인에서 그리면 묻고, 다시 맞추면 묻지 않는다', () => {
    vi.useFakeTimers()
    renderNote()
    live()
    draw()
    // #258 서버가 받았다고 답하기 전에는 온라인에서 그린 것도 남은 것이다
    expect(leaving()).toBe(true)
    act(() => void vi.advanceTimersByTime(CHECK_AFTER_MS))
    act(() => latest().answerChecks())
    expect(leaving()).toBe(false)
    vi.useRealTimers()
    offline()
    draw()
    expect(leaving()).toBe(true)
    live()
    expect(leaving()).toBe(false)
  })

  // #258 소켓이 말없이 죽으면(오프라인 사건 없이) 곧 새로 붙고, 그동안 그린 것은 남는다
  test('맞춘 연결에서 한동안 아무것도 받지 못하면 새로 붙고, 그 사이 그린 것을 묻는다', () => {
    vi.useFakeTimers()
    renderNote()
    live()
    const dead = latest()
    dead.synced = true
    dead.wsLastMessageReceived = Date.now()
    draw()
    act(() => void vi.advanceTimersByTime(SILENT_AFTER_MS - 1_000))
    expect(latest()).toBe(dead)
    act(() => void vi.advanceTimersByTime(2_000))
    expect(latest()).not.toBe(dead)
    expect(leaving()).toBe(true)
    vi.useRealTimers()
  })

  test('맞춘 연결에서 무엇이든 계속 받으면 새로 붙지 않는다', () => {
    vi.useFakeTimers()
    renderNote()
    live()
    const p = latest()
    p.synced = true
    for (let i = 0; i < 3; i++) {
      p.wsLastMessageReceived = Date.now()
      act(() => void vi.advanceTimersByTime(SILENT_AFTER_MS - 1_000))
    }
    expect(latest()).toBe(p)
    vi.useRealTimers()
  })

  test('남은 변경이 있어도 막힘 화면이 되면 묻지 않는다', () => {
    renderNote()
    live()
    offline()
    draw()
    expect(leaving()).toBe(true)
    act(() => latest().emit('connection-close', [{ code: 4410 }]))
    expect(leaving()).toBe(false)
  })

  // #252 앱 안 링크(「기록」)로 노트를 떠날 때도 묻는다
  function renderRoutes() {
    render(
      <MemoryRouter initialEntries={['/note/n1']}>
        <Routes>
          <Route path="/note/n1" element={<NotePage initial={NOTE} />} />
          <Route path="/note/n1/history" element={<p>기록 화면</p>} />
        </Routes>
      </MemoryRouter>,
    )
  }
  const history = () => screen.getByRole('link', { name: '기록' })

  test('오프라인에서 그리고 「기록」을 누르면 묻고, 머무르면 그대로 노트에 남는다', async () => {
    renderRoutes()
    live()
    offline()
    draw()
    await userEvent.click(history())
    const dialog = screen.getByRole('alertdialog', { name: '아직 보내지 못한 변경이 있어요' })
    expect(screen.getByRole('button', { name: '머무르기' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(dialog).not.toBeInTheDocument()
    expect(screen.queryByText('기록 화면')).not.toBeInTheDocument()
    expect(history()).toHaveFocus()
  })

  test('묻는 창에서 떠나기를 누르면 기록으로 간다', async () => {
    renderRoutes()
    live()
    offline()
    draw()
    await userEvent.click(history())
    await userEvent.click(screen.getByRole('button', { name: '떠나기' }))
    expect(screen.getByText('기록 화면')).toBeInTheDocument()
  })

  test('온라인에서 그리고 「기록」을 누르면 묻지 않고 바로 간다', async () => {
    renderRoutes()
    live()
    drawAndConfirm()
    await userEvent.click(history())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('기록 화면')).toBeInTheDocument()
  })
})
