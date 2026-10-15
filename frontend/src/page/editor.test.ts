import { Editor } from '@tiptap/core'
import { textBoxExtensions, TEXT_SIZES } from './editorExtensions'
import { textStyle } from './textStyle'

function editorWith(html: string) {
  const editor = new Editor({ extensions: textBoxExtensions(), content: html })
  return editor
}

function marksIn(json: unknown): string[] {
  const out = new Set<string>()
  const walk = (n: { marks?: { type: string }[]; content?: unknown[] }) => {
    n.marks?.forEach((m) => out.add(m.type))
    n.content?.forEach((c) => walk(c as typeof n))
  }
  walk(json as never)
  return [...out].sort()
}

test('붙여넣은 서식 중 허용된 것만 남긴다', () => {
  const editor = editorWith(
    '<h1>제목</h1><ul><li>목록</li></ul><p><a href="https://x">링크</a> <b>굵게</b> <i>기울임</i> <u>밑줄</u> <s>취소</s> <code>코드</code></p><img src="x.png">',
  )
  const json = editor.getJSON()
  const nodeTypes = new Set((json.content ?? []).map((n) => n.type))
  expect([...nodeTypes]).toEqual(['paragraph'])
  expect(marksIn(json)).toEqual(['bold', 'italic', 'strike', 'underline'])
  expect(editor.getText()).toContain('제목')
  expect(editor.getText()).toContain('링크')
  editor.destroy()
})

test('글자 색과 크기는 textStyle 마크로 저장된다', () => {
  const editor = editorWith('<p>안녕</p>')
  editor.chain().selectAll().setColor('#E0603A').setFontSize(TEXT_SIZES[2].value!).run()
  const mark = editor.getJSON().content![0].content![0].marks![0]
  expect(mark.type).toBe('textStyle')
  expect(mark.attrs).toMatchObject({ color: '#E0603A', fontSize: TEXT_SIZES[2].value })
  editor.destroy()
})

test('PNG 렌더용 스타일은 서식 마크를 반영한다', () => {
  const style = textStyle(
    { color: '#2A47B0', fontSize: 28, font: 'pen' },
    { bold: {}, italic: {}, underline: {}, textStyle: { color: '#E0603A', fontSize: '1.15em' } },
  )
  expect(style).toMatchObject({ bold: true, italic: true, underline: true, color: '#E0603A', size: 32 })
  expect(style.canvasFont).toBe("italic 700 32px 'Nanum Pen Script', cursive")
})
