import * as Y from 'yjs'
import { createPageDoc, readTextBoxes, textBoxContent, textBoxText } from './doc'
import { linesOf, wrapLine } from './exportPng'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { clampMoveDelta } from './hit'
import { canvasPixelRatio, MAX_CANVAS_PIXELS } from './render'
import { createTextBoxAt, shouldRemoveOnBlur, snapBoxPosition } from './textbox'

function boxWith(text: string, author = '졸린 수달') {
  const doc = createPageDoc('2026-10-15')
  const id = createTextBoxAt(doc, { x: 0, y: 0 }, { color: '#000', author })
  const p = new Y.XmlElement('paragraph')
  if (text) p.insert(0, [new Y.XmlText(text)])
  textBoxContent(doc, id)!.insert(0, [p])
  return { doc, id }
}

describe('글 상자 글자 읽기', () => {
  test('사용자가 쓴 꺾쇠 글자는 서식 태그로 오해하지 않는다', () => {
    const { doc, id } = boxWith('<중요> <3 그리고 >')
    expect(textBoxText(doc, id)).toBe('<중요> <3 그리고 >')
  })
})

describe('빈 상자 지우기', () => {
  test('내가 만든 빈 상자만, 다른 사람이 쓰고 있지 않을 때 지운다', () => {
    const { doc, id } = boxWith('')
    expect(shouldRemoveOnBlur(doc, id, '졸린 수달', false)).toBe(true)
    expect(shouldRemoveOnBlur(doc, id, '푸른 펭귄', false)).toBe(false)
    expect(shouldRemoveOnBlur(doc, id, '졸린 수달', true)).toBe(false)
  })

  test('내용이 있으면 지우지 않는다', () => {
    const { doc, id } = boxWith('메모')
    expect(shouldRemoveOnBlur(doc, id, '졸린 수달', false)).toBe(false)
  })
})

describe('PNG 줄', () => {
  test('Shift+Enter 줄바꿈은 새 줄이 된다', () => {
    const runs = [
      { text: 'A', marks: {} },
      { text: '\n', marks: {} },
      { text: 'B', marks: {} },
    ]
    expect(linesOf(runs).map((l) => l.map((r) => r.text).join(''))).toEqual(['A', 'B'])
  })

  test('이모지가 있어도 접는 위치가 글자 단위로 맞는다', () => {
    const measure = (s: string) => Array.from(s).length * 10
    expect(wrapLine('😀😀😀😀', 20, measure)).toEqual(['😀😀', '😀😀'])
  })
})

describe('장 범위', () => {
  test('옮긴 상자는 장 밖으로 넘치지 않는다', () => {
    expect(snapBoxPosition({ x: 1480, y: 5000 }, 360)).toEqual({ x: PAGE_WIDTH - 360, y: PAGE_HEIGHT - 32 })
    expect(snapBoxPosition({ x: -50, y: -10 }, 360)).toEqual({ x: 0, y: 0 })
  })

  test('획 묶음을 장 밖으로 끌면 가장자리에서 멈춘다', () => {
    const bounds = { x: 100, y: 100, width: 200, height: 50 }
    expect(clampMoveDelta(bounds, -500, 0)).toEqual({ dx: -100, dy: 0 })
    expect(clampMoveDelta(bounds, 5000, 5000)).toEqual({ dx: PAGE_WIDTH - 300, dy: PAGE_HEIGHT - 150 })
    expect(clampMoveDelta(bounds, 10, -20)).toEqual({ dx: 10, dy: -20 })
  })
})

describe('캔버스 크기', () => {
  test('큰 배율·고해상도에서도 캔버스 픽셀 수 상한을 넘지 않는다', () => {
    const ratio = canvasPixelRatio(PAGE_WIDTH, PAGE_HEIGHT, 3)
    expect(PAGE_WIDTH * ratio * PAGE_HEIGHT * ratio).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(canvasPixelRatio(400, 600, 2)).toBe(2)
  })
})

test('기존 상자 읽기는 그대로 동작한다', () => {
  const { doc } = boxWith('x')
  expect(readTextBoxes(doc)).toHaveLength(1)
})
