// @vitest-environment node
import * as Y from 'yjs'
import { createPageDoc, readTextBoxes, textBoxContent } from './doc'
import { createTextBoxAt, removeIfEmpty, removeLeftoverEmptyBoxes, MIN_BOX_WIDTH, clampBoxWidth, nudgeBox, fitBoxInPage } from './textbox'

test('글 상자 위치는 32px 칸에 맞춰진다', () => {
  const doc = createPageDoc('2026-10-15')
  const id = createTextBoxAt(doc, { x: 210.4, y: 117 }, { color: '#2A47B0', author: '졸린 수달' })
  const box = readTextBoxes(doc).find((b) => b.id === id)!
  expect(box.y).toBe(96) // 117은 96~127 칸 안
  expect(box.y % 32).toBe(0)
  expect(box.x).toBe(210)
})

test('내용이 빈 상자만 지운다', () => {
  const doc = createPageDoc('2026-10-15')
  const empty = createTextBoxAt(doc, { x: 0, y: 0 }, { color: '#000', author: 'a' })
  const filled = createTextBoxAt(doc, { x: 0, y: 64 }, { color: '#000', author: 'a' })
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.insert(0, [new Y.XmlText('캠핑장 후보')])
  textBoxContent(doc, filled)!.insert(0, [paragraph])

  expect(removeIfEmpty(doc, empty)).toBe(true)
  expect(removeIfEmpty(doc, filled)).toBe(false)
  expect(readTextBoxes(doc).map((b) => b.id)).toEqual([filled])
})

test('공백 줄만 있는 상자도 빈 상자다', () => {
  const doc = createPageDoc('2026-10-15')
  const id = createTextBoxAt(doc, { x: 0, y: 0 }, { color: '#000', author: 'a' })
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('   ')])
  textBoxContent(doc, id)!.insert(0, [p, new Y.XmlElement('paragraph')])
  expect(removeIfEmpty(doc, id)).toBe(true)
})

test('폭은 최소 폭과 장 오른쪽 끝 사이로 제한된다', () => {
  expect(clampBoxWidth(10, 100)).toBe(MIN_BOX_WIDTH)
  expect(clampBoxWidth(5000, 1400)).toBe(200)
  expect(clampBoxWidth(300, 100)).toBe(300)
})

test('손잡이에서 화살표로 옮기면 좌우 8px, 위아래 한 줄씩 움직이고 장 밖으로 나가지 않는다', () => {
  const box = { x: 100, y: 64, width: 360 }
  expect(nudgeBox(box, 'ArrowRight')).toEqual({ x: 108, y: 64 })
  expect(nudgeBox(box, 'ArrowDown')).toEqual({ x: 100, y: 96 })
  expect(nudgeBox(box, 'ArrowUp')).toEqual({ x: 100, y: 32 })
  expect(nudgeBox({ x: 0, y: 0, width: 360 }, 'ArrowLeft')).toEqual({ x: 0, y: 0 })
  expect(nudgeBox({ x: 0, y: 0, width: 360 }, 'ArrowUp')).toEqual({ x: 0, y: 0 })
  expect(nudgeBox(box, 'Enter')).toBeNull()
})

describe('누른 칸에 상자가 생긴다', () => {
  // 종이 줄은 y = 31 + 32k 에 그려진다. k번째 칸은 32k ~ 32k+31.
  const topAt = (y: number) => {
    const doc = createPageDoc('2026-10-15')
    const id = createTextBoxAt(doc, { x: 100, y }, { color: '#000', author: 'a' })
    return readTextBoxes(doc).find((b) => b.id === id)!.y
  }

  test('칸의 위쪽·가운데·아래쪽 어디를 눌러도 그 칸', () => {
    expect(topAt(96 + 2)).toBe(96)
    expect(topAt(96 + 16)).toBe(96)
    expect(topAt(96 + 29)).toBe(96)
  })

  test('줄 바로 아래를 누르면 아래 칸', () => {
    expect(topAt(128 + 1)).toBe(128)
  })

  test('장 맨 아래 칸보다 아래로는 가지 않는다', () => {
    expect(topAt(2399)).toBe(2400 - 32)
  })
})

describe('장 아래로 넘친 상자', () => {
  test('넘치지 않으면 그대로', () => {
    expect(fitBoxInPage(2304, 64)).toBe(2304)
  })

  test('줄이 늘어 장 아래로 넘치면 칸 단위로 끌어올린다', () => {
    expect(fitBoxInPage(2368, 64)).toBe(2336)
    expect(fitBoxInPage(2368, 70)).toBe(2304) // 줄 높이가 칸에 딱 맞지 않아도 넘친 만큼 칸 단위로
  })

  test('장보다 큰 상자는 맨 위에 붙인다', () => {
    expect(fitBoxInPage(500, 3000)).toBe(0)
  })
})

describe('들어올 때 남은 빈 상자 정리', () => {
  function filled(doc: Y.Doc, author: string) {
    const id = createTextBoxAt(doc, { x: 0, y: 200 }, { color: '#000', author })
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText('글')])
    textBoxContent(doc, id)!.insert(0, [p])
    return id
  }

  test('내가 만든 빈 상자 중 아무도 쓰지 않는 것만 지운다', () => {
    const doc = createPageDoc('2026-10-16')
    const mine = createTextBoxAt(doc, { x: 0, y: 0 }, { color: '#000', author: '나' })
    const mineEditing = createTextBoxAt(doc, { x: 0, y: 64 }, { color: '#000', author: '나' })
    const theirs = createTextBoxAt(doc, { x: 0, y: 128 }, { color: '#000', author: '남' })
    const mineFilled = filled(doc, '나')
    expect(removeLeftoverEmptyBoxes(doc, '나', new Set([mineEditing]))).toEqual([mine])
    expect(readTextBoxes(doc).map((b) => b.id).sort()).toEqual([mineEditing, theirs, mineFilled].sort())
  })
})
