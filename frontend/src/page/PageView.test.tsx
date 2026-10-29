import { fireEvent, render, screen } from '@testing-library/react'
import * as Y from 'yjs'
import { PageView } from './PageView'
import { PAN_START_EVENT } from './touchPan'

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

describe('끌던 중 Esc·Ctrl+Z는 하던 것을 거둔다', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  })

  function eraserFrame() {
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
    return { el: container.querySelector('.page-frame') as HTMLElement, calls }
  }

  test('지우개를 끌던 중 Esc: cancel이 불리고, 바깥(집중 모드 등)의 Esc 처리는 돌지 않는다', () => {
    const { el, calls } = eraserFrame()
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(calls).toEqual(['down', 'cancel'])
    expect(outer).not.toHaveBeenCalled()
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    expect(calls).toEqual(['down', 'cancel'])
    // 끌지 않을 때의 Esc는 바깥으로 간다
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(outer).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', outer)
  })

  test('끌던 중 Ctrl+Z는 되돌리기가 아니라 취소다', () => {
    const { el, calls } = eraserFrame()
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(calls).toEqual(['down', 'cancel'])
    expect(outer).not.toHaveBeenCalled()
    window.removeEventListener('keydown', outer)
  })

  test('펜으로 긋던 중 Esc를 누르면 그 획은 저장되지 않는다', () => {
    const doc = new Y.Doc()
    const { container } = render(<PageView doc={doc} tool="pen" ink="#000" widthLevel={1} author="나" />)
    const el = container.querySelector('.page-frame') as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'mouse', clientX: 160, clientY: 120, buttons: 1 })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', clientX: 160, clientY: 120 })
    expect(doc.getMap('strokes').size).toBe(0)
    // 다음 획은 정상으로 저장된다
    fireEvent.pointerDown(el, { pointerId: 2, pointerType: 'mouse', clientX: 100, clientY: 200, button: 0, buttons: 1 })
    fireEvent.pointerMove(el, { pointerId: 2, pointerType: 'mouse', clientX: 160, clientY: 220, buttons: 1 })
    fireEvent.pointerUp(el, { pointerId: 2, pointerType: 'mouse', clientX: 160, clientY: 220 })
    expect(doc.getMap('strokes').size).toBe(1)
  })
})

describe('손가락 스크롤이 시작되면 지면이 알린다', () => {
  test('글 상자(data-page-ui) 위에 첫 손가락, 다른 곳에 둘째 손가락 → PAN_START_EVENT 한 번', () => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
    const { container } = render(
      <PageView doc={new Y.Doc()} tool="select" ink="#000" widthLevel={1} author="나">
        <button type="button" data-page-ui>
          손잡이
        </button>
      </PageView>,
    )
    const frame = container.querySelector('.page-frame') as HTMLElement
    const started = vi.fn()
    frame.addEventListener(PAN_START_EVENT, started)
    fireEvent.pointerDown(screen.getByRole('button', { name: '손잡이' }), { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, buttons: 1 })
    expect(started).not.toHaveBeenCalled()
    fireEvent.pointerDown(frame, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100, buttons: 1 })
    expect(started).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(frame, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    fireEvent.pointerUp(frame, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 })
  })
})

describe('채색 붓', () => {
  test('채색 도구로 그으면 불투명도·부드러움이 붙은 paint 획이 저장되고, 라이브 캔버스는 multiply로 섞인다', () => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
    const doc = new Y.Doc()
    const { container } = render(
      <PageView doc={doc} tool="paint" ink="#f2c230" widthLevel={1} author="나" paintWidth={64} paintOpacity={0.3} paintSoft />,
    )
    const el = container.querySelector('.page-frame') as HTMLElement
    expect(container.querySelector('canvas.color-canvas')).toBeInTheDocument()
    expect(container.querySelector('canvas.live-canvas')).toHaveAttribute('data-blend', 'multiply')
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 120, buttons: 1 })
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 120 })
    const strokes = doc.getMap('strokes')
    expect(strokes.size).toBe(1)
    const m = [...strokes.values()][0] as Y.Map<unknown>
    expect(m.get('tool')).toBe('paint')
    expect(m.get('width')).toBe(64)
    expect(m.get('opacity')).toBe(0.3)
    expect(m.get('soft')).toBe(true)
  })
})

describe('도형 채움', () => {
  test('채움을 켜고 사각형을 그리면 fill이 붙고, 화살표에는 붙지 않는다', () => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
    const drawShape = (shape: 'rect' | 'arrow') => {
      const doc = new Y.Doc()
      const { container, unmount } = render(
        <PageView doc={doc} tool="shape" shape={shape} shapeFill={0.6} ink="#000" widthLevel={1} author="나" />,
      )
      const el = container.querySelector('.page-frame') as HTMLElement
      fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, button: 0, buttons: 1 })
      fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 250, buttons: 1 })
      fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 250 })
      const m = [...doc.getMap('strokes').values()][0] as Y.Map<unknown> | undefined
      unmount()
      return m?.get('fill')
    }
    expect(drawShape('rect')).toBe(0.6)
    expect(drawShape('arrow')).toBeUndefined()
  })
})

describe('스포이트', () => {
  test('스포이트 모드에서 지면을 누르면 그 자리 색을 알리고 획은 생기지 않는다(캔버스가 없으면 종이 바탕색)', () => {
    HTMLElement.prototype.setPointerCapture = () => {}
    const doc = new Y.Doc()
    const onPick = vi.fn()
    const { container } = render(<PageView doc={doc} tool="pen" ink="#000" widthLevel={1} author="나" picking onPick={onPick} />)
    const el = container.querySelector('.page-frame') as HTMLElement
    expect(el).toHaveAttribute('data-picking', 'true')
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 })
    expect(onPick).toHaveBeenCalledWith('#ffffff')
    expect(doc.getMap('strokes').size).toBe(0)
  })
})

// iPadOS Safari는 펜슬로 빠르게 이어 그으면 다음 획의 pointerdown을 빠뜨린다. 그 획은 터치 이벤트로 긋는다.
describe('포인터 이벤트가 빠진 펜슬 획은 터치 이벤트로 긋는다', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  })

  function stylus(type: string, el: Element, x: number, y: number, touchType = 'stylus') {
    const e = new Event(type, { bubbles: true, cancelable: true })
    const t = { identifier: 7, clientX: x, clientY: y, force: 0.5, touchType }
    Object.assign(e, { changedTouches: [t], touches: type === 'touchend' ? [] : [t] })
    el.dispatchEvent(e)
  }

  function penFrame() {
    const doc = new Y.Doc()
    const { container } = render(<PageView doc={doc} tool="pen" ink="#000" widthLevel={1} author="나" />)
    return { doc, el: container.querySelector('.page-frame') as HTMLElement }
  }
  const strokeCount = (doc: Y.Doc) => doc.getMap('strokes').size

  test('pointerdown 없이 온 펜슬 터치로 획 하나를 남긴다', () => {
    const { doc, el } = penFrame()
    stylus('touchstart', el, 10, 10)
    stylus('touchmove', el, 30, 30)
    stylus('touchmove', el, 50, 40)
    stylus('touchend', el, 50, 40)
    expect(strokeCount(doc)).toBe(1)
    const [stroke] = [...doc.getMap<Y.Map<unknown>>('strokes').values()]
    expect(stroke.get('tool')).toBe('pen')
  })

  test('포인터 이벤트가 받은 획은 터치 이벤트로 한 번 더 긋지 않는다', () => {
    const { doc, el } = penFrame()
    fireEvent.pointerDown(el, { pointerId: 3, pointerType: 'pen', clientX: 10, clientY: 10, button: 0, buttons: 1, pressure: 0.5 })
    stylus('touchstart', el, 10, 10)
    fireEvent.pointerMove(el, { pointerId: 3, pointerType: 'pen', clientX: 40, clientY: 40, buttons: 1, pressure: 0.5 })
    stylus('touchmove', el, 40, 40)
    fireEvent.pointerUp(el, { pointerId: 3, pointerType: 'pen', clientX: 40, clientY: 40 })
    stylus('touchend', el, 40, 40)
    expect(strokeCount(doc)).toBe(1)
  })

  test('손가락 터치는 이 길로 긋지 않는다', () => {
    const { doc, el } = penFrame()
    stylus('touchstart', el, 10, 10, 'direct')
    stylus('touchmove', el, 40, 40, 'direct')
    stylus('touchend', el, 40, 40, 'direct')
    expect(strokeCount(doc)).toBe(0)
  })
})

describe('여러 손가락 탭과 화면 고정', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  })
  const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', el: Element, id: number, x: number, y: number) =>
    fireEvent[type](el, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, buttons: 1 })

  test('두 손가락 탭은 onFingerTap(2)를 부르고, 첫 손가락이 긋기 시작한 획은 남기지 않는다', () => {
    const doc = new Y.Doc()
    const onFingerTap = vi.fn()
    const { container } = render(<PageView doc={doc} tool="pen" ink="#000" widthLevel={1} author="나" onFingerTap={onFingerTap} />)
    const el = container.querySelector('.page-frame') as HTMLElement
    touch('pointerDown', el, 1, 100, 100)
    touch('pointerDown', el, 2, 200, 100)
    touch('pointerUp', el, 1, 100, 100)
    expect(onFingerTap).not.toHaveBeenCalled()
    touch('pointerUp', el, 2, 200, 100)
    expect(onFingerTap).toHaveBeenCalledWith(2)
    expect(doc.getMap('strokes').size).toBe(0)
  })

  test('화면 고정이면 두 손가락으로 끌어도 화면이 움직이지 않고, Ctrl+휠 확대도 하지 않는다', () => {
    const onZoom = vi.fn()
    const { container } = render(
      <PageView doc={new Y.Doc()} tool="pen" ink="#000" widthLevel={1} author="나" viewLocked onZoom={onZoom} />,
    )
    const vp = container.querySelector('.page-viewport') as HTMLElement
    const el = container.querySelector('.page-frame') as HTMLElement
    expect(vp.style.overflow).toBe('hidden')
    // jsdom에는 배치가 없어 손가락 스크롤은 문서를 옮긴다
    const page = document.scrollingElement ?? document.documentElement
    page.scrollTop = 50
    touch('pointerDown', el, 1, 100, 100)
    touch('pointerDown', el, 2, 200, 100)
    touch('pointerMove', el, 1, 100, 40)
    touch('pointerMove', el, 2, 200, 40)
    touch('pointerUp', el, 1, 100, 40)
    touch('pointerUp', el, 2, 200, 40)
    expect(page.scrollTop).toBe(50)
    const wheel = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })
    vp.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(onZoom).not.toHaveBeenCalled()
  })

  test('고정하지 않으면 두 손가락으로 끌어 화면을 옮긴다', () => {
    const { container } = render(<PageView doc={new Y.Doc()} tool="pen" ink="#000" widthLevel={1} author="나" />)
    const el = container.querySelector('.page-frame') as HTMLElement
    const page = document.scrollingElement ?? document.documentElement
    page.scrollTop = 50
    touch('pointerDown', el, 1, 100, 100)
    touch('pointerDown', el, 2, 200, 100)
    touch('pointerMove', el, 1, 100, 80)
    touch('pointerMove', el, 2, 200, 80)
    expect(page.scrollTop).not.toBe(50)
  })
})

// 선택 도구의 지면은 touch-action: pan-x pan-y 라 손가락이 17px쯤 움직이면 브라우저가 스크롤로 가져가며 옮기기가 끊겼다.
describe('고른 것을 손가락으로 끌 때는 브라우저 스크롤을 막는다', () => {
  const touchEvent = (el: Element, type: string, touches: number) => {
    const e = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'touches', { value: Array.from({ length: touches }) })
    el.dispatchEvent(e)
    return e.defaultPrevented
  }
  function select(grabbing: boolean) {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
    const pointerTool = { down: () => true, grabbing: () => grabbing }
    const { container } = render(
      <PageView doc={new Y.Doc()} tool="select" ink="#000" widthLevel={1} author="나" pointerTool={pointerTool} />,
    )
    return container.querySelector('.page-frame') as HTMLElement
  }
  const down = (el: HTMLElement, id = 1, pointerType = 'touch') =>
    fireEvent.pointerDown(el, { pointerId: id, pointerType, clientX: 100, clientY: 100, button: 0, buttons: 1 })

  test('옮기는 중인 한 손가락: touchmove의 기본 동작(스크롤)을 막는다', () => {
    const el = select(true)
    down(el)
    expect(touchEvent(el, 'touchstart', 1)).toBe(true)
    expect(touchEvent(el, 'touchmove', 1)).toBe(true)
  })

  test('빈 곳에서 시작한 한 손가락(상자 고르기)은 스크롤을 막지 않는다', () => {
    const el = select(false)
    down(el)
    expect(touchEvent(el, 'touchmove', 1)).toBe(false)
  })

  test('두 번째 손가락이 닿으면 막지 않는다(두 손가락 이동·확대)', () => {
    const el = select(true)
    down(el)
    down(el, 2)
    expect(touchEvent(el, 'touchmove', 2)).toBe(false)
    expect(touchEvent(el, 'touchmove', 1)).toBe(false)
  })

  test('손가락을 떼면 다음 스크롤은 막지 않는다', () => {
    const el = select(true)
    down(el)
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 })
    expect(touchEvent(el, 'touchmove', 1)).toBe(false)
  })

  test('펜도 같다', () => {
    const el = select(true)
    down(el, 1, 'pen')
    expect(touchEvent(el, 'touchmove', 1)).toBe(true)
  })
})

describe('펜 지우개 버튼(#95)', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  })

  function penFrame() {
    const calls: string[] = []
    const tool = (name: string) => ({
      down: () => (calls.push(`${name}:down`), true),
      move: () => void calls.push(`${name}:move`),
      up: () => void calls.push(`${name}:up`),
      cancel: () => void calls.push(`${name}:cancel`),
    })
    const doc = new Y.Doc()
    const { container } = render(
      <PageView doc={doc} tool="select" ink="#000" widthLevel={1} author="나" pointerTool={tool('select')} penEraserTool={tool('eraser')} />,
    )
    return { el: container.querySelector('.page-frame') as HTMLElement, calls, doc }
  }

  test('지우개 버튼을 누른 채 그으면 지금 도구 대신 지우개가 받고, 떼면 원래 도구로 돌아간다', () => {
    const { el, calls } = penFrame()
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'pen', clientX: 100, clientY: 100, button: 5, buttons: 32 })
    fireEvent.pointerMove(el, { pointerId: 1, pointerType: 'pen', clientX: 120, clientY: 100, button: -1, buttons: 32 })
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'pen', clientX: 120, clientY: 100, button: 5, buttons: 0 })
    expect(calls).toEqual(['eraser:down', 'eraser:move', 'eraser:up'])
    fireEvent.pointerDown(el, { pointerId: 2, pointerType: 'pen', clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.pointerUp(el, { pointerId: 2, pointerType: 'pen', clientX: 100, clientY: 100, button: 0, buttons: 0 })
    expect(calls.slice(3)).toEqual(['select:down', 'select:up'])
  })

  test('펜 도구로 쓰던 중에도 지우개 버튼이면 획을 남기지 않는다', () => {
    const calls: string[] = []
    const eraser = { down: () => (calls.push('down'), true), up: () => void calls.push('up') }
    const doc = new Y.Doc()
    const { container } = render(<PageView doc={doc} tool="pen" ink="#000" widthLevel={1} author="나" penEraserTool={eraser} />)
    const el = container.querySelector('.page-frame') as HTMLElement
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'pen', clientX: 100, clientY: 100, button: 5, buttons: 32 })
    fireEvent.pointerUp(el, { pointerId: 1, pointerType: 'pen', clientX: 140, clientY: 100, button: 5, buttons: 0 })
    expect(calls).toEqual(['down', 'up'])
    expect(doc.getMap('strokes').size).toBe(0)
  })

  test('마우스 오른쪽 버튼 등 다른 버튼은 여전히 무시한다', () => {
    const { el, calls } = penFrame()
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, button: 2, buttons: 2 })
    expect(calls).toEqual([])
  })
})
