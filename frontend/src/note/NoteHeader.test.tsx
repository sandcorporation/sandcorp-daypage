import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { NoteHeader } from './NoteHeader'
import type { NoteDetail, Peer } from './types'

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

/** phone 불리언은 390폭·1440폭의 줄임이다 */
function setup(others: number, size: boolean | number) {
  const width = typeof size === 'number' ? size : size ? 390 : 1440
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width <= Number(/max-width: (\d+)px/.exec(query)?.[1] ?? -1),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  const peersOf = (n: number): Peer[] => Array.from({ length: n }, (_, i) => ({
    clientId: i + 2,
    nickname: `졸린 수달${i}`,
    color: '#8b5cf6',
    cursor: null,
    editingBoxId: null,
    isMe: false,
  }))
  const header = (n: number) => (
    <MemoryRouter>
      <NoteHeader note={NOTE} page={NOTE.page} clockOffset={0} peers={peersOf(n)} onRename={async () => {}} onShare={() => {}} />
    </MemoryRouter>
  )
  const { rerender } = render(header(others))
  setPeers = (n) => rerender(header(n))
  return screen.getByRole('group', { name: `함께 있는 사람 ${others + 1}명` })
}

/** 같은 화면에서 나 말고 접속한 사람 수를 바꾼다 */
let setPeers: (others: number) => void

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => vi.unstubAllGlobals())

test.each([
  { phone: true, others: 1, faces: 2, more: null },
  { phone: true, others: 2, faces: 2, more: '+1' },
  { phone: true, others: 8, faces: 2, more: '+7' },
  { phone: false, others: 5, faces: 6, more: null },
  { phone: false, others: 8, faces: 6, more: '+3' },
])('함께 있는 사람: 폰=$phone, 나 말고 $others → 얼굴 $faces, 나머지 $more', ({ phone, others, faces, more }) => {
  const group = setup(others, phone)
  expect(group.querySelectorAll('.avatar:not(.avatar-more)')).toHaveLength(faces)
  if (more) expect(within(group).getByText(more)).toHaveClass('avatar-more')
  else expect(group.querySelector('.avatar-more')).toBeNull()
})

test('아바타의 접근 이름은 닉네임(자기는 「(나)」)이고, 「+N」은 모두 보기 단추다', () => {
  const group = setup(3, true)
  expect(within(group).getAllByRole('img').map((el) => el.getAttribute('aria-label'))).toEqual(['말랑한 고양이(나)', '졸린 수달0'])
  const more = within(group).getByRole('button', { name: '함께 있는 사람 4명 모두 보기' })
  expect(more).toHaveTextContent('+2')
  expect(more).toHaveAttribute('aria-expanded', 'false')
})

const everyone = (others: number) => ['말랑한 고양이(나)', ...Array.from({ length: others }, (_, i) => `졸린 수달${i}`)]
const listed = () => within(screen.getByRole('dialog')).getAllByRole('listitem').map((el) => el.textContent?.replace(/^.(?=말|졸)/, ''))

test.each([
  { width: 720, more: '+6' },
  { width: 721, more: '+6' },
  { width: 1023, more: '+6' },
  { width: 1024, more: '+5' },
  { width: 1279, more: '+5' },
  { width: 1280, more: '+2' },
])('#220 폭 $width: 「$more」를 누르면 함께 있는 사람 8명 전부가 목록에 나온다', async ({ width, more }) => {
  setup(7, width)
  const button = screen.getByRole('button', { name: '함께 있는 사람 8명 모두 보기' })
  expect(button).toHaveTextContent(more)
  await userEvent.click(button)
  expect(screen.getByRole('dialog', { name: '함께 있는 사람 8명' })).toBeInTheDocument()
  expect(button).toHaveAttribute('aria-expanded', 'true')
  expect(listed()).toEqual(everyone(7))
})

test('#220 열린 목록은 접속자를 따라 바뀌고, 「+N」이 없어지면 닫히며 초점은 얼굴 묶음에 간다', async () => {
  setup(4, 768)
  await userEvent.click(screen.getByRole('button', { name: /모두 보기$/ }))
  act(() => setPeers(6))
  expect(screen.getByRole('dialog', { name: '함께 있는 사람 7명' })).toBeInTheDocument()
  expect(listed()).toEqual(everyone(6))
  await act(async () => setPeers(1))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('group', { name: '함께 있는 사람 2명' })).toHaveFocus()
})

test.each(['{Enter}', ' '])('#220 키보드(%j)로 열고 Esc로 닫으면 초점이 단추로 돌아온다', async (key) => {
  setup(4, 768)
  const button = screen.getByRole('button', { name: /모두 보기$/ })
  button.focus()
  await userEvent.keyboard(key)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(button).toHaveFocus()
})

test('#220 바깥을 누르면 닫히고 초점이 단추로 돌아온다. 다른 단추를 눌렀으면 초점을 뺏지 않는다', async () => {
  setup(4, 768)
  const button = screen.getByRole('button', { name: /모두 보기$/ })
  await userEvent.click(button)
  await userEvent.click(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(button).toHaveFocus()
  await userEvent.click(button)
  const share = screen.getByRole('button', { name: '링크 공유' })
  await userEvent.click(share)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(share).toHaveFocus()
})

test.each([{ phone: true }, { phone: false }])('자기 닉네임은 글자로 한 번 보인다: 폰=$phone', ({ phone }) => {
  setup(1, phone)
  const mine = screen.getByText('말랑한 고양이', { selector: 'b' })
  expect(mine.parentElement).toHaveTextContent('나: 말랑한 고양이')
  // 폰에서는 좁은 오른쪽 단추 줄이 아니라 남은 시간 줄에 둔다
  expect(mine.closest('.note-sub') !== null).toBe(phone)
})
