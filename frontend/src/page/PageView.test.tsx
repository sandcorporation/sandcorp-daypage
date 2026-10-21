import { fireEvent, render } from '@testing-library/react'
import * as Y from 'yjs'
import { PageView } from './PageView'

beforeEach(() => {
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

function frame(tool: 'pen' | 'text') {
  const { container } = render(
    <PageView doc={new Y.Doc()} tool={tool} ink="#000" widthLevel={1} author="나">
      <div data-page-ui>
        <p contentEditable suppressContentEditableWarning>
          글 상자
        </p>
      </div>
    </PageView>,
  )
  return container.querySelector('.page-frame') as HTMLElement
}

// iPad 펜슬로 천천히 긋거나 잠깐 멈추면 Safari가 길게 누르기로 보고 글자 선택·'복사하기' 메뉴를 띄워 그리기를 가로챘다.
describe('그리는 도구일 때 지면은 글자 선택·길게 누르기 메뉴를 막는다', () => {
  test('지면에서 시작한 선택과 메뉴는 막는다', () => {
    const el = frame('pen')
    expect(fireEvent(el, new Event('selectstart', { bubbles: true, cancelable: true }))).toBe(false)
    expect(fireEvent.contextMenu(el)).toBe(false)
  })

  test('글 상자 안에서는 글을 고르고 메뉴를 열 수 있다', () => {
    const el = frame('pen')
    const text = el.querySelector('[contenteditable]') as HTMLElement
    expect(fireEvent(text, new Event('selectstart', { bubbles: true, cancelable: true }))).toBe(true)
    expect(fireEvent.contextMenu(text)).toBe(true)
  })

  test('글씨 도구에서도 지면 빈 곳의 선택은 막는다', () => {
    const el = frame('text')
    expect(fireEvent(el, new Event('selectstart', { bubbles: true, cancelable: true }))).toBe(false)
  })
})
