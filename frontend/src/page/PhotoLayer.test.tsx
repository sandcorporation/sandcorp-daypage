import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { PhotoControls } from './PhotoLayer'
import { addPhoto, deletePhoto, readPhotos, type Photo } from './photos'
import { useUndo } from './useUndo'

const ORIGIN = 'me'

function photo(id: string, createdAt: number, over: Partial<Photo> = {}): Photo {
  return { id, src: `src-${id}`, x: 100, y: 100, width: 300, height: 200, author: '졸린 수달', createdAt, ...over }
}

function setup(...photos: Photo[]) {
  const doc = new Y.Doc()
  for (const p of photos) addPhoto(doc, p)
  const { result } = renderHook(() => useUndo(doc, ORIGIN))
  render(<PhotoControls doc={doc} scale={1} origin={ORIGIN} onPreview={() => {}} inStep={result.current.inStep} />)
  const at = (id: string) => {
    const { x, y, width, height } = readPhotos(doc).find((p) => p.id === id)!
    return { x, y, width, height }
  }
  const press = (name: string, key: string, init: KeyboardEventInit = {}) => {
    let passed = true
    act(() => {
      passed = fireEvent.keyDown(screen.getByRole('button', { name }), { key, ...init })
    })
    return passed
  }
  const undo = () => act(() => void result.current.undo())
  return { doc, at, press, undo }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test('손잡이 이름에 넣은 순서의 사진 번호가 들어간다(겹치는 순서와 상관없이)', () => {
  setup(photo('a', 1, { order: 1 }), photo('b', 2, { order: 0 }))
  const names = screen.getAllByRole('button').map((el) => el.getAttribute('aria-label'))
  expect(names).toEqual(['사진 2 옮기기', '사진 2 빼기', '사진 2 크기 조절', '사진 1 옮기기', '사진 1 빼기', '사진 1 크기 조절'])
})

test('옮기기 손잡이의 화살표는 그 사진만 한 걸음, Shift는 큰 걸음 옮기고 화면으로 새지 않는다', () => {
  const { at, press } = setup(photo('a', 1), photo('b', 2))
  expect(press('사진 2 옮기기', 'ArrowRight')).toBe(false)
  press('사진 2 옮기기', 'ArrowDown')
  expect(at('b')).toEqual({ x: 108, y: 132, width: 300, height: 200 })
  press('사진 2 옮기기', 'ArrowLeft', { shiftKey: true })
  press('사진 2 옮기기', 'ArrowUp', { shiftKey: true })
  expect(at('b')).toEqual({ x: 76, y: 4, width: 300, height: 200 })
  expect(at('a')).toEqual({ x: 100, y: 100, width: 300, height: 200 })
})

test('화살표가 아닌 키와 Ctrl·Alt·Meta를 함께 누른 화살표는 그대로 둔다', () => {
  const { at, press } = setup(photo('a', 1))
  expect(press('사진 1 옮기기', 'a')).toBe(true)
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) expect(press('사진 1 옮기기', 'ArrowRight', { [mod]: true })).toBe(true)
  expect(at('a')).toEqual({ x: 100, y: 100, width: 300, height: 200 })
})

test('화살표로 옮겨도 종이 밖으로 나가지 않는다', () => {
  const { at, press } = setup(photo('a', 1, { x: 3, y: PAGE_HEIGHT - 203 }))
  press('사진 1 옮기기', 'ArrowLeft', { shiftKey: true })
  press('사진 1 옮기기', 'ArrowDown', { shiftKey: true })
  expect(at('a')).toMatchObject({ x: 0, y: PAGE_HEIGHT - 200 })
})

test('크기 손잡이의 화살표는 비율을 지키며 키우고 줄이고, 종이를 넘지 않는다', () => {
  const { at, press } = setup(photo('a', 1, { x: PAGE_WIDTH - 320 }))
  press('사진 1 크기 조절', 'ArrowRight')
  expect(at('a')).toMatchObject({ width: 308, height: 205 })
  press('사진 1 크기 조절', 'ArrowLeft')
  expect(at('a')).toMatchObject({ width: 300, height: 200 })
  press('사진 1 크기 조절', 'ArrowDown', { shiftKey: true })
  expect(at('a')).toMatchObject({ width: 320 })
  press('사진 1 크기 조절', 'ArrowUp')
  expect(at('a')).toMatchObject({ width: 312 })
})

test('천천히 이어 누른 화살표도 되돌리기 한 번에 처음 자리로 가고, 앞의 작업과 섞이지 않는다', () => {
  const { doc, at, press, undo } = setup(photo('a', 1))
  act(() => addPhoto(doc, photo('b', 2), ORIGIN))
  press('사진 1 옮기기', 'ArrowRight')
  vi.advanceTimersByTime(2000)
  press('사진 1 옮기기', 'ArrowRight')
  undo()
  expect(at('a')).toMatchObject({ x: 100 })
  expect(readPhotos(doc)).toHaveLength(2)
})

test('손잡이를 떠났다 돌아오거나 되돌린 뒤의 화살표는 새 단계다', () => {
  const { doc, at, press, undo } = setup(photo('a', 1), photo('b', 2))
  act(() => deletePhoto(doc, 'b', ORIGIN))
  press('사진 1 옮기기', 'ArrowRight')
  act(() => void fireEvent.blur(screen.getByRole('button', { name: '사진 1 옮기기' })))
  press('사진 1 옮기기', 'ArrowRight')
  undo()
  expect(at('a')).toMatchObject({ x: 108 })
  press('사진 1 옮기기', 'ArrowRight')
  undo()
  expect(at('a')).toMatchObject({ x: 108 })
  undo()
  expect(at('a')).toMatchObject({ x: 100 })
  expect(readPhotos(doc)).toHaveLength(1)
})

test('화살표 바로 뒤의 다른 작업은 따로 되돌린다', () => {
  const { doc, at, press, undo } = setup(photo('a', 1))
  press('사진 1 옮기기', 'ArrowRight')
  act(() => addPhoto(doc, photo('b', 2), ORIGIN))
  undo()
  expect(readPhotos(doc)).toHaveLength(1)
  expect(at('a')).toMatchObject({ x: 108 })
})
