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

// iOS Safari는 포인터 이벤트를 막아도 길게 누르기(선택·돋보기·'복사하기')를 touchstart가 막혀야만 포기한다.
describe('그리는 도구일 때 지면의 touchstart를 막는다', () => {
  const touch = (el: Element) => {
    const e = new Event('touchstart', { bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e.defaultPrevented
  }

  test('펜 도구: 지면에 닿은 터치는 기본 동작을 막는다', () => {
    const el = frame('pen')
    expect(touch(el)).toBe(true)
  })

  test('글 상자(data-page-ui) 위의 터치는 그대로 둔다(글 편집·키보드)', () => {
    const el = frame('pen')
    expect(touch(el.querySelector('[contenteditable]')!)).toBe(false)
  })

  test('선택 도구는 손가락 스크롤을 써야 하니 막지 않는다', () => {
    const { container } = render(
      <PageView doc={new Y.Doc()} tool="select" ink="#000" widthLevel={1} author="나" />,
    )
    expect(touch(container.querySelector('.page-frame')!)).toBe(false)
  })
})

describe('두 번째 손가락이 닿으면 도구 동작을 거둔다', () => {
  test('지우개: 첫 손가락이 닿은 자리의 획을 지우지 않고 cancel로 거둔다', () => {
    // jsdom에는 포인터 캡처가 없다
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
    const calls: string[] = []
    const pointerTool = {
      down: () => (calls.push('down'), true),
      move: () => void calls.push('move'),
      up: () => void calls.push('up'),
      cancel: () => void calls.push('cancel'),
    }
    const { container } = render(
      <PageView doc={new Y.Doc()} tool="eraser" ink="#000" widthLevel={1} author="나" pointerTool={pointerTool} eraserRadius={10} />,
    )
    const el = container.querySelector('.page-frame') as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, button: 0, buttons: 1 })
    expect(calls).toEqual(['down'])
    fireEvent.pointerDown(el, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100, button: 0, buttons: 1 })
    expect(calls).toEqual(['down', 'cancel'])
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(el, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 })
    expect(calls).toEqual(['down', 'cancel'])
  })
})
