import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { FakeProvider } from '../test/fakeProvider'
import { NotePage } from './NotePage'
import type { NoteDetail } from './types'

vi.mock('y-websocket', async () => ({ WebsocketProvider: (await import('../test/fakeProvider')).FakeProvider }))

const NOTE: NoteDetail = {
  id: 'n1',
  name: '우리 노트',
  url: 'http://localhost/note/n1',
  isOwner: false,
  today: '2026-10-15',
  nextMidnight: '2026-10-16T00:00:00+09:00',
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
  expect(screen.getByRole('button', { name: '노트 색 #16794f' })).toBeInTheDocument()
})

test('고르고 있던 노트 색이 빠지면 기본 잉크로 돌아간다', async () => {
  renderNote()
  act(() => latest().receive(102, { type: 'note_colors', colors: ['#16794f'] }))
  await userEvent.click(screen.getByRole('button', { name: '노트 색 #16794f' }))
  expect(screen.getByRole('button', { name: '노트 색 #16794f' })).toHaveAttribute('aria-pressed', 'true')
  act(() => latest().receive(102, { type: 'note_colors', colors: [] }))
  expect(screen.queryByRole('button', { name: '노트 색 #16794f' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '잉크 파랑' })).toHaveAttribute('aria-pressed', 'true')
})
