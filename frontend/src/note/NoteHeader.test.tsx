import { render, screen, within } from '@testing-library/react'
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

function setup(others: number, phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query === '(max-width: 720px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  const peers: Peer[] = Array.from({ length: others }, (_, i) => ({
    clientId: i + 2,
    nickname: `졸린 수달${i}`,
    color: '#8b5cf6',
    cursor: null,
    editingBoxId: null,
    isMe: false,
  }))
  render(
    <MemoryRouter>
      <NoteHeader note={NOTE} page={NOTE.page} clockOffset={0} peers={peers} onRename={async () => {}} onShare={() => {}} />
    </MemoryRouter>,
  )
  return screen.getByRole('group', { name: `함께 있는 사람 ${others + 1}명` })
}

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

test('아바타의 접근 이름은 닉네임(자기는 「(나)」)이고, 「+N」은 「그 밖에 N명」이다', () => {
  const group = setup(3, true)
  expect(within(group).getAllByRole('img').map((el) => el.getAttribute('aria-label'))).toEqual([
    '말랑한 고양이(나)',
    '졸린 수달0',
    '그 밖에 2명',
  ])
})

test.each([{ phone: true }, { phone: false }])('자기 닉네임은 글자로 한 번 보인다: 폰=$phone', ({ phone }) => {
  setup(1, phone)
  const mine = screen.getByText('말랑한 고양이', { selector: 'b' })
  expect(mine.parentElement).toHaveTextContent('나: 말랑한 고양이')
  // 폰에서는 좁은 오른쪽 단추 줄이 아니라 남은 시간 줄에 둔다
  expect(mine.closest('.note-sub') !== null).toBe(phone)
})
