// @vitest-environment node
import * as Y from 'yjs'
import { createPageDoc, textBoxContent } from './doc'
import { createTextBoxAt } from './textbox'
import { exportFileName, paragraphsOf, wrapLine } from './exportPng'

const measure = (s: string) => s.length * 10

test('긴 줄은 폭에 맞춰 단어 단위로 접는다', () => {
  expect(wrapLine('캠핑 준비물 목록 정리', 70, measure)).toEqual(['캠핑 준비물 ', '목록 정리'])
})

test('한 단어가 폭보다 길면 글자 단위로 자른다', () => {
  expect(wrapLine('가나다라마바사', 30, measure)).toEqual(['가나다', '라마바', '사'])
})

test('빈 줄도 한 줄로 남긴다', () => {
  expect(wrapLine('', 100, measure)).toEqual([''])
})

test('글 상자 내용을 문단과 서식 조각으로 읽는다', () => {
  const doc = createPageDoc('2026-10-15')
  const id = createTextBoxAt(doc, { x: 0, y: 0 }, { color: '#000', author: 'a' })
  const p1 = new Y.XmlElement('paragraph')
  const t1 = new Y.XmlText()
  t1.insert(0, '굵은', { bold: {} })
  t1.insert(2, ' 글', {}) // 속성을 주지 않으면 앞 글자의 굵게를 이어받는다
  p1.insert(0, [t1])
  const p2 = new Y.XmlElement('paragraph')
  textBoxContent(doc, id)!.insert(0, [p1, p2])
  expect(paragraphsOf(doc, id)).toEqual([
    [
      { text: '굵은', marks: { bold: {} } },
      { text: ' 글', marks: {} },
    ],
    [],
  ])
})

test('저장 파일 이름에는 노트 이름과 날짜가 들어간다', () => {
  expect(exportFileName('우리집/공용 노트', '2026-10-14')).toBe('daypage-우리집_공용 노트-2026-10-14.png')
})
