import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Y from 'yjs'
import { PhotoPanel } from './PhotoPanel'
import { addPhoto, PHOTO_LIMIT, readPhotos, type Photo } from './photos'

function photo(id: string, createdAt: number, author = '졸린 수달'): Photo {
  return { id, src: `src-${id}`, x: 0, y: 0, width: 100, height: 100, author, createdAt }
}

function setup(over: Partial<Parameters<typeof PhotoPanel>[0]> = {}) {
  const doc = new Y.Doc()
  const props = {
    doc,
    base: '/api/notes/n1/photos',
    hidden: new Set<string>(),
    onToggleHidden: vi.fn(),
    onHighlight: vi.fn(),
    onAdd: vi.fn(),
    addBlocked: null,
    ...over,
  }
  return { doc, props, rerender: () => render(<PhotoPanel {...props} />) }
}

test('사진이 없으면 안내하고, 붙이기를 누르면 파일을 고른다', async () => {
  const { props, rerender } = setup()
  rerender()
  expect(screen.getByText('이 페이지에는 아직 사진이 없어요.')).toBeInTheDocument()
  expect(screen.getByText(`0/${PHOTO_LIMIT}장`, { exact: false })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '+ 사진 붙이기' }))
  expect(props.onAdd).toHaveBeenCalled()
})

test('사진을 앞에 있는 것부터 미리보기·붙인 사람과 함께 보인다', () => {
  const { doc, rerender } = setup()
  addPhoto(doc, photo('a', 1, '졸린 수달'))
  addPhoto(doc, photo('b', 2, '푸른 펭귄'))
  rerender()
  const rows = screen.getAllByRole('listitem')
  expect(within(rows[0]).getByText('사진 2')).toBeInTheDocument()
  expect(within(rows[0]).getByText('푸른 펭귄')).toBeInTheDocument()
  expect(rows[1].querySelector('img')?.getAttribute('src')).toBe('/api/notes/n1/photos/src-a')
})

test('빼면 문서에서 빠진다(모두에게)', async () => {
  const { doc, rerender } = setup()
  addPhoto(doc, photo('a', 1))
  rerender()
  await userEvent.click(screen.getByRole('button', { name: '사진 1 빼기' }))
  expect(readPhotos(doc)).toEqual([])
  expect(await screen.findByText('이 페이지에는 아직 사진이 없어요.')).toBeInTheDocument()
})

test('숨기기는 내 화면 설정으로 넘긴다', async () => {
  const { doc, props, rerender } = setup({ hidden: new Set(['a']) })
  addPhoto(doc, photo('a', 1))
  rerender()
  expect(screen.getByText('내 화면에서 숨김', { exact: false })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '사진 1 보이기' }))
  expect(props.onToggleHidden).toHaveBeenCalledWith('a')
})

test('Alt+↑로 앞으로 보낸다', async () => {
  const { doc, rerender } = setup()
  addPhoto(doc, photo('a', 1))
  addPhoto(doc, photo('b', 2))
  rerender()
  screen.getByRole('button', { name: /^사진 1,/ }).focus()
  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
  expect(readPhotos(doc).map((p) => p.id)).toEqual(['b', 'a'])
})

test('한도가 차면 붙이기가 꺼진다', () => {
  const { rerender } = setup({ addBlocked: '사진은 한 페이지에 3장까지 붙일 수 있어요' })
  rerender()
  expect(screen.getByRole('button', { name: '+ 사진 붙이기' })).toBeDisabled()
})

test('아이패드: 손잡이를 손가락으로 끌어 맨 앞으로 놓는다', () => {
  const { doc, rerender } = setup()
  addPhoto(doc, photo('a', 1))
  addPhoto(doc, photo('b', 2))
  rerender()
  const items = screen.getAllByRole('listitem')
  items.forEach((li, i) => {
    li.getBoundingClientRect = () => ({ top: i * 50, bottom: i * 50 + 50, left: 0, right: 300, width: 300, height: 50, x: 0, y: i * 50, toJSON() {} })
  })
  const before = readPhotos(doc).map((p) => p.id)
  const grip = within(items[1]).getByRole('button', { name: /순서 바꾸기$/ })
  const at = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', target: Element | Window, clientY: number) =>
    fireEvent[type](target, { pointerId: 3, pointerType: 'touch', clientX: 10, clientY, button: 0, buttons: 1 })
  act(() => void at('pointerDown', grip, 75))
  act(() => void at('pointerMove', window, 10))
  act(() => void at('pointerUp', window, 10))
  expect(readPhotos(doc).map((p) => p.id)).toEqual([...before].reverse())
})
