import { act, renderHook } from '@testing-library/react'
import * as Y from 'yjs'
import { addStroke, addTextBox, readStrokes, readTextBoxes, textBoxContent, type Stroke } from './doc'
import { createUndoManager } from './undo'
import { useEditTools } from './useEditTools'

const shift = { shiftKey: true } as never
const plain = {} as never

function line(id: string, x1: number, y1: number, x2: number, y2: number, author = '나'): Stroke {
  return { id, tool: 'pen', color: '#2A47B0', width: 4, points: [x1, y1, 0.5, x2, y2, 0.5], author, createdAt: 1 }
}

function text(doc: Y.Doc, id: string, x: number, y: number, author = '나') {
  addTextBox(doc, { id, x, y, width: 200, color: '#222', fontSize: 20, author })
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('글')])
  textBoxContent(doc, id)?.insert(0, [p])
}

const pointsOf = (doc: Y.Doc, id: string) => readStrokes(doc).find((s) => s.id === id)?.points
const boxOf = (doc: Y.Doc, id: string) => {
  const b = readTextBoxes(doc).find((t) => t.id === id)
  return b && { x: b.x, y: b.y }
}

/** 획 a(위), b(아래), 글 상자 t(가운데, 높이 40) */
function setup(opts: { additive?: boolean; onlyAuthor?: string | null } = {}) {
  const doc = new Y.Doc()
  addStroke(doc, line('a', 100, 100, 300, 100))
  addStroke(doc, line('b', 100, 500, 300, 500))
  text(doc, 't', 400, 288)
  const undo = createUndoManager(doc, 'me')
  const hook = renderHook(
    ({ additive }) =>
      useEditTools(doc, 'select', 'me', undefined, 1, undefined, undefined, opts.onlyAuthor ?? null, false, {
        additive,
        textHeight: () => 40,
      }),
    { initialProps: { additive: opts.additive ?? false } },
  )
  const t = () => hook.result.current.pointerTool
  const click = (x: number, y: number, e = plain) => {
    act(() => void t()?.down?.({ x, y }, e))
    act(() => void t()?.up?.({ x, y }, e))
  }
  return { doc, hook, t, click, undo, sel: () => hook.result.current.selected }
}

describe('shift+클릭으로 더하기·빼기', () => {
  test('shift+클릭은 획과 글 상자를 고른 것에 더하고, 이미 고른 것은 뺀다', () => {
    const { click, sel } = setup()
    click(200, 102)
    click(200, 502, shift)
    click(450, 300, shift)
    expect(sel()).toEqual({ strokes: ['a', 'b'], texts: ['t'] })
    click(200, 102, shift)
    expect(sel()).toEqual({ strokes: ['b'], texts: ['t'] })
    click(450, 300, shift)
    expect(sel()).toEqual({ strokes: ['b'], texts: [] })
  })

  test('shift 없이 누르면 그것만 새로 고르고, 빈 곳을 누르면 풀린다', () => {
    const { click, sel } = setup()
    click(200, 102)
    click(450, 300, shift)
    click(200, 502)
    expect(sel()).toEqual({ strokes: ['b'], texts: [] })
    click(450, 300)
    expect(sel()).toEqual({ strokes: [], texts: ['t'] })
    click(900, 900)
    expect(sel()).toEqual({ strokes: [], texts: [] })
  })

  test('상자로 두르면 글 상자도 걸리고, shift+상자 끌기는 고른 것에 더한다', () => {
    const { t, click, sel } = setup()
    click(200, 502)
    act(() => void t()?.down?.({ x: 50, y: 50 }, shift))
    act(() => void t()?.move?.({ x: 420, y: 300 }))
    act(() => void t()?.up?.({ x: 420, y: 300 }, shift))
    expect(sel()).toEqual({ strokes: ['b', 'a'], texts: ['t'] })
  })

  test('더해 고르기(터치 토글)를 켜면 shift 없이도 더하고 뺀다', () => {
    const { click, sel } = setup({ additive: true })
    click(200, 102)
    click(450, 300)
    expect(sel()).toEqual({ strokes: ['a'], texts: ['t'] })
    click(450, 300)
    expect(sel()).toEqual({ strokes: ['a'], texts: [] })
    // 빈 곳을 눌러도 풀리지 않는다
    click(900, 900)
    expect(sel()).toEqual({ strokes: ['a'], texts: [] })
  })

  test('내 획만 고르기면 남의 글 상자도 고르지 않는다', () => {
    const doc = new Y.Doc()
    text(doc, 'theirs', 400, 288, '남')
    const hook = renderHook(() => useEditTools(doc, 'select', 'me', undefined, 1, undefined, undefined, '나', false, { textHeight: () => 40 }))
    act(() => void hook.result.current.pointerTool?.down?.({ x: 450, y: 300 }, shift))
    expect(hook.result.current.selected.texts).toEqual([])
  })
})

describe('섞인 묶음 옮기기', () => {
  function pick() {
    const s = setup()
    s.click(200, 102)
    s.click(200, 502, shift)
    s.click(450, 300, shift)
    s.undo.stopCapturing()
    return s
  }

  test('끄는 동안은 미리보기만 보이고, 놓으면 획과 글 상자를 같은 만큼 옮긴다', () => {
    const { doc, hook, t } = pick()
    act(() => void t()?.down?.({ x: 200, y: 102 }, plain))
    act(() => void t()?.move?.({ x: 210, y: 166 }))
    expect(hook.result.current.live.move?.ids).toEqual(['a', 'b'])
    expect(hook.result.current.live.move?.texts).toEqual(['t'])
    expect(boxOf(doc, 't')).toEqual({ x: 400, y: 288 })
    act(() => void t()?.up?.({ x: 210, y: 166 }, plain))
    expect(hook.result.current.live.move).toBeNull()
    expect(pointsOf(doc, 'a')).toEqual([110, 164, 0.5, 310, 164, 0.5])
    expect(pointsOf(doc, 'b')).toEqual([110, 564, 0.5, 310, 564, 0.5])
    expect(boxOf(doc, 't')).toEqual({ x: 410, y: 352 })
  })

  test('글 상자가 섞이면 줄 간격에 맞춰 옮겨 글 상자가 줄 위에 남는다', () => {
    const { doc, t } = pick()
    act(() => void t()?.down?.({ x: 200, y: 102 }, plain))
    act(() => void t()?.move?.({ x: 200, y: 112 }))
    act(() => void t()?.up?.({ x: 200, y: 112 }, plain))
    // 10만큼 끌면 가까운 줄(0칸)에 남는다
    expect(boxOf(doc, 't')).toEqual({ x: 400, y: 288 })
    expect(pointsOf(doc, 'a')).toEqual([100, 100, 0.5, 300, 100, 0.5])
  })

  test('글 상자를 잡고 끌어도 묶음 전체가 옮겨진다', () => {
    const { doc, t } = pick()
    act(() => void t()?.down?.({ x: 450, y: 300 }, plain))
    act(() => void t()?.move?.({ x: 450, y: 332 }))
    act(() => void t()?.up?.({ x: 450, y: 332 }, plain))
    expect(boxOf(doc, 't')).toEqual({ x: 400, y: 320 })
    expect(pointsOf(doc, 'a')).toEqual([100, 132, 0.5, 300, 132, 0.5])
  })

  test('되돌리기 한 번에 모두 원위치된다', () => {
    const { doc, t, undo } = pick()
    act(() => void t()?.down?.({ x: 200, y: 102 }, plain))
    act(() => void t()?.move?.({ x: 210, y: 166 }))
    act(() => void t()?.up?.({ x: 210, y: 166 }, plain))
    undo.undo()
    expect(pointsOf(doc, 'a')).toEqual([100, 100, 0.5, 300, 100, 0.5])
    expect(pointsOf(doc, 'b')).toEqual([100, 500, 0.5, 300, 500, 0.5])
    expect(boxOf(doc, 't')).toEqual({ x: 400, y: 288 })
  })

  test('옮긴 위치는 문서에 저장되어 다시 열어도 그대로다', () => {
    const { doc, t } = pick()
    act(() => void t()?.down?.({ x: 200, y: 102 }, plain))
    act(() => void t()?.move?.({ x: 210, y: 166 }))
    act(() => void t()?.up?.({ x: 210, y: 166 }, plain))
    const reopened = new Y.Doc()
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc))
    expect(pointsOf(reopened, 'a')).toEqual([110, 164, 0.5, 310, 164, 0.5])
    expect(boxOf(reopened, 't')).toEqual({ x: 410, y: 352 })
  })

  test('섞인 묶음에는 크기·회전 손잡이가 없다(모서리를 끌면 옮기기)', () => {
    const { hook, t } = pick()
    // 묶음 상자 왼쪽 위 모서리(여백 6) 근처
    let cursor: string | null | undefined
    act(() => void (cursor = t()?.hover?.({ x: 94, y: 94 })))
    expect(cursor).toBe('move')
    act(() => void t()?.down?.({ x: 94, y: 94 }, plain))
    act(() => void t()?.move?.({ x: 60, y: 60 }))
    expect(hook.result.current.live.move?.m.slice(0, 4)).toEqual([1, 0, 0, 1])
  })

  test('지우기는 글 상자까지 지우고, 되돌리기 한 번에 돌아온다', () => {
    const { doc, hook, undo } = pick()
    act(() => hook.result.current.deleteSelected())
    expect(readStrokes(doc)).toEqual([])
    expect(readTextBoxes(doc)).toEqual([])
    expect(hook.result.current.selected).toEqual({ strokes: [], texts: [] })
    undo.undo()
    expect(readStrokes(doc).map((s) => s.id).sort()).toEqual(['a', 'b'])
    expect(readTextBoxes(doc).map((b) => b.id)).toEqual(['t'])
  })
})
