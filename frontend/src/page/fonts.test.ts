import { createPageDoc, readTextBoxes, updateTextBox } from './doc'
import { DEFAULT_FONT, FONTS, fontOf } from './fonts'
import { createTextBoxAt } from './textbox'
import { textStyle } from './textStyle'
import { createUndoManager } from './undo'

test('글꼴은 손글씨 4종과 고딕·명조 6종이다', () => {
  expect(FONTS.map((f) => f.id)).toEqual(['pen', 'gaegu', 'gamja', 'himelody', 'gothic', 'myeongjo'])
  expect(DEFAULT_FONT.id).toBe('pen')
})

test('글꼴 값이 없거나 모르는 값이면 기본 글꼴로 그린다', () => {
  expect(fontOf(undefined).id).toBe('pen')
  expect(fontOf('comic-sans').id).toBe('pen')
  expect(fontOf('gothic').family).toContain('Gothic A1')
})

test('고른 글꼴로 상자를 만들면 그 글꼴의 기본 크기를 쓴다', () => {
  const doc = createPageDoc('2026-10-15')
  const id = createTextBoxAt(doc, { x: 0, y: 0 }, { color: '#000', author: 'a', font: 'myeongjo' })
  const box = readTextBoxes(doc).find((b) => b.id === id)!
  expect(box.font).toBe('myeongjo')
  expect(box.fontSize).toBe(fontOf('myeongjo').size)
  expect(textStyle(box, {}).family).toContain('Nanum Myeongjo')
})

test('글꼴 변경은 내 작업 되돌리기로 취소된다', () => {
  const doc = createPageDoc('2026-10-15')
  const mine = {}
  const undo = createUndoManager(doc, mine)
  const id = createTextBoxAt(doc, { x: 0, y: 0 }, { color: '#000', author: 'a' }, mine)
  undo.stopCapturing()
  updateTextBox(doc, id, { font: 'gaegu', fontSize: fontOf('gaegu').size }, mine)
  expect(readTextBoxes(doc)[0].font).toBe('gaegu')
  undo.undo()
  expect(readTextBoxes(doc)[0].font).toBe('pen')
})
