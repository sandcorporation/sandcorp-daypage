import { act, fireEvent, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { textboxesMap } from './doc'
import { TextLayer } from './TextLayer'
import { createTextBoxAt } from './textbox'
import { PAN_START_EVENT } from './touchPan'
import { EditPreview } from './useEditTools'

beforeEach(() => {
  // jsdom에는 포인터 캡처가 없다
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
})

function setup() {
  const doc = new Y.Doc()
  const id = createTextBoxAt(doc, { x: 300, y: 400 }, { color: '#000', author: '나' })
  const onFrameDown = vi.fn()
  const { container } = render(
    <div className="page-frame" onPointerDown={onFrameDown}>
      <TextLayer
        doc={doc}
        tool="select"
        scale={1}
        readOnly={false}
        origin="me"
        focusId={null}
        onFocusHandled={() => {}}
        onEditing={() => {}}
        editors={new Map()}
        me="나"
      />
    </div>,
  )
  const pos = () => {
    const m = textboxesMap(doc).get(id)!
    return { x: m.get('x') as number, y: m.get('y') as number }
  }
  const grip = screen.getByRole('button', { name: /글 상자 옮기기/ })
  const frame = container.querySelector('.page-frame') as HTMLElement
  // 만들 때 y는 줄에 맞춰 조정되므로 시작 위치는 읽어서 쓴다
  return { pos, grip, frame, onFrameDown, start: pos() }
}

describe('글 상자 끌기와 손가락 스크롤', () => {
  test('마우스로 손잡이를 끌면 옮겨진다(기준 동작)', () => {
    const { pos, grip, start } = setup()
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, buttons: 1 })
    fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'mouse', clientX: 160, clientY: 220, buttons: 1 })
    fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'mouse', clientX: 160, clientY: 220 })
    expect(pos().x).toBe(360)
    expect(pos().y).toBeGreaterThan(start.y)
  })

  test('손가락은 지면에도 알리고(전파), 손가락 스크롤이 시작되면 끌기를 거둬 상자가 움직이지 않는다', () => {
    const { pos, grip, frame, onFrameDown, start } = setup()
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, buttons: 1 })
    expect(onFrameDown).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientX: 110, clientY: 130, buttons: 1 })
    frame.dispatchEvent(new Event(PAN_START_EVENT))
    fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientX: 160, clientY: 300, buttons: 1 })
    fireEvent.pointerUp(grip, { pointerId: 1, pointerType: 'touch', clientX: 160, clientY: 300 })
    expect(pos()).toEqual(start)
  })

  test('마우스 끌기는 지면에 전파하지 않는다(지면이 선택 상자를 그리지 않게)', () => {
    const { grip, onFrameDown } = setup()
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, buttons: 1 })
    expect(onFrameDown).not.toHaveBeenCalled()
  })

  test('브라우저가 포인터를 가져가면(pointercancel) 옮기지 않는다', () => {
    const { pos, grip, start } = setup()
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, buttons: 1 })
    fireEvent.pointerMove(grip, { pointerId: 1, pointerType: 'touch', clientX: 160, clientY: 220, buttons: 1 })
    fireEvent.pointerCancel(grip, { pointerId: 1, pointerType: 'touch' })
    expect(pos()).toEqual(start)
  })
})

describe('선택 도구로 섞어 고르기', () => {
  function setupSelect() {
    const doc = new Y.Doc()
    const id = createTextBoxAt(doc, { x: 300, y: 400 }, { color: '#000', author: '나' })
    const preview = new EditPreview()
    const props = {
      doc,
      tool: 'select' as const,
      scale: 1,
      readOnly: false,
      origin: 'me',
      focusId: null,
      onFocusHandled: () => {},
      onEditing: () => {},
      editors: new Map(),
      me: '나',
      editPreview: preview,
    }
    const { container, rerender } = render(<TextLayer {...props} />)
    const el = () => container.querySelector<HTMLElement>(`[data-box-id="${id}"]`)!
    return { id, preview, el, rerender, props }
  }

  test('상자 몸통은 지면이 받는다(선택 도구가 고르게), 손잡이는 상자가 받는다', () => {
    const { el } = setupSelect()
    expect(el().hasAttribute('data-page-ui')).toBe(false)
    expect(screen.getByRole('button', { name: /글 상자 옮기기/ }).hasAttribute('data-page-ui')).toBe(true)
  })

  test('묶음을 끄는 동안 고른 상자를 같은 만큼 옮겨 보이고, 고른 상자는 표시된다', () => {
    const { id, preview, el, rerender, props } = setupSelect()
    const left = el().style.left
    act(() => preview.setMove({ ids: [], texts: [id], m: [1, 0, 0, 1, 20, 32] }))
    expect(el().style.left).toBe(`${parseFloat(left) + 20}px`)
    act(() => preview.setMove(null))
    expect(el().style.left).toBe(left)
    rerender(<TextLayer {...props} selectedTexts={[id]} />)
    expect(el().classList.contains('is-picked')).toBe(true)
  })
})
