import * as Y from 'yjs'
import { createPageDoc, readTextBoxes, textBoxContent } from './doc'
import { createTextBoxAt, removeIfEmpty, MIN_BOX_WIDTH, clampBoxWidth, nudgeBox } from './textbox'

test('글 상자 위치는 32px 줄에 맞춰진다', () => {
  const doc = createPageDoc('2026-10-15')
  const id = createTextBoxAt(doc, { x: 210.4, y: 117 }, { color: '#2A47B0', author: '졸린 수달' })
  const box = readTextBoxes(doc).find((b) => b.id === id)!
  expect(box.y).toBe(128)
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
