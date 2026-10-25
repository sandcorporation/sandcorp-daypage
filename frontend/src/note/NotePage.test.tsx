import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { FakeProvider } from '../test/fakeProvider'
import { NotePage } from './NotePage'
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
})

test('노트 색이 바뀌었다는 알림(102)을 받으면 도구 막대가 바로 바뀐다', async () => {
  renderNote()
  act(() => latest().receive(102, { type: 'note_colors', colors: ['#16794f'] }))
  await userEvent.click(screen.getByRole('button', { name: /^잉크:/ }))
  expect(screen.getByRole('button', { name: '노트 색 #16794f' })).toBeInTheDocument()
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

test('집중 모드를 켜면 머리글·아래 칩이 숨고 전체 화면을 시도하며, Esc로 나온다', async () => {
  const request = vi.fn(async () => {})
  Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true })
  renderNote()
  expect(screen.getByRole('button', { name: '링크 공유' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '집중 모드' }))
  expect(request).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '링크 공유' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '새 소식' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '확대' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: '링크 공유' })).toBeInTheDocument()
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
