import { act, fireEvent, render, screen } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import * as Y from 'yjs'
import { PageView } from '../page/PageView'
import { FontPicker } from '../page/FontPicker'
import { ToolPopover } from './ToolPopover'
import { useDismiss } from './useDismiss'

// #206 팝오버를 바깥 누르기로 닫는 그 누르기는 지면에 그리지 않는다.

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
})

afterEach(() => vi.unstubAllGlobals())

function PopoverCase() {
  const [open, setOpen] = useState(true)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchor} type="button">
        열기
      </button>
      {open && (
        <ToolPopover title="펜" anchor={anchor} onClose={() => setOpen(false)}>
          내용
        </ToolPopover>
      )}
    </>
  )
}

function DismissCase() {
  const [open, setOpen] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  return <div ref={ref}>{open && <div role="dialog">내용</div>}</div>
}

function FontCase() {
  return <FontPicker font="gaegu" onFont={() => {}} />
}

const closers = [
  { name: '도구 창(ToolPopover)', Closer: PopoverCase, popup: 'dialog' },
  { name: '머리글 팝오버(useDismiss)', Closer: DismissCase, popup: 'dialog' },
  { name: '글꼴 목록(FontPicker)', Closer: FontCase, popup: 'listbox' },
]

function setup(Closer: () => React.ReactNode) {
  const doc = new Y.Doc()
  const history = new Y.UndoManager(doc.getMap('strokes'))
  const { container } = render(
    <>
      <Closer />
      <PageView doc={doc} tool="pen" ink="#000" widthLevel={1} author="나" />
    </>,
  )
  const opener = screen.queryByRole('button', { name: /^글꼴:/ })
  if (opener) act(() => opener.click())
  const el = container.querySelector('.page-frame') as HTMLElement
  return { el, strokes: () => doc.getMap('strokes').size, undo: () => history.undoStack.length }
}

const at = (x: number, pointerType: string) => ({ pointerId: 1, pointerType, clientX: x, clientY: x, button: 0, buttons: 1, pressure: 0.5 })

function press(el: Element, pointerType: string) {
  fireEvent.pointerDown(el, at(10, pointerType))
  fireEvent.pointerMove(el, at(60, pointerType))
  fireEvent.pointerUp(el, at(60, pointerType))
}

function stylus(type: string, el: Element, x: number) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const t = { identifier: 7, clientX: x, clientY: x, force: 0.5, touchType: 'stylus' }
  Object.assign(e, { changedTouches: [t], touches: type === 'touchend' ? [] : [t] })
  fireEvent(el, e)
}

describe.each(closers)('$name', ({ Closer, popup }) => {
  test.each(['pen', 'touch', 'mouse'])('지면을 눌러 닫는 %s 누르기는 획·되돌리기 기록을 남기지 않고, 다음 누르기는 그린다', (type) => {
    const { el, strokes, undo } = setup(Closer)
    expect(screen.getByRole(popup)).toBeInTheDocument()
    press(el, type)
    expect(screen.queryByRole(popup)).not.toBeInTheDocument()
    expect(strokes()).toBe(0)
    expect(undo()).toBe(0)
    press(el, type)
    expect(strokes()).toBe(1)
  })
})

// iPad: 펜슬은 pointerdown 뒤에 같은 접촉의 touchstart가 온다. 그 길로도 긋지 않아야 한다.
describe('펜슬 터치 길', () => {
  function pencil(el: Element, withPointer: boolean) {
    if (withPointer) fireEvent.pointerDown(el, at(10, 'pen'))
    stylus('touchstart', el, 10)
    stylus('touchmove', el, 60)
    if (withPointer) fireEvent.pointerUp(el, at(60, 'pen'))
    stylus('touchend', el, 60)
  }

  test('닫는 누르기의 touchstart로도 긋지 않고, 다음 획은 pointerdown이 빠져도 그린다', () => {
    const { el, strokes } = setup(PopoverCase)
    pencil(el, true)
    expect(strokes()).toBe(0)
    pencil(el, false)
    expect(strokes()).toBe(1)
  })

  test('touchstart가 오지 않는 브라우저에서도 다음 획의 터치 길을 막지 않는다', () => {
    const { el, strokes } = setup(PopoverCase)
    press(el, 'pen')
    pencil(el, false)
    expect(strokes()).toBe(1)
  })
})
