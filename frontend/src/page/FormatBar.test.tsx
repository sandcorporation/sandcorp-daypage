import { Editor } from '@tiptap/react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { textBoxExtensions } from './editorExtensions'
import { FormatBar } from './FormatBar'

function setup(noteColors: string[] = []) {
  const editor = new Editor({ extensions: textBoxExtensions(), content: '<p>안녕</p>' })
  editor.commands.selectAll()
  render(<FormatBar editor={editor} scale={1} noteColors={noteColors} />)
  return editor
}

const colorOf = (editor: Editor) => editor.getAttributes('textStyle').color as string | undefined

test('글자 색 버튼을 누르면 기본 글자 색과 노트 색이 펼쳐진다', async () => {
  setup(['#16794f'])
  expect(screen.queryByRole('button', { name: '글자 색 노트 색 #16794f' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^글자 색:/ }))
  expect(screen.getByRole('button', { name: '글자 색 잉크 파랑' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '글자 색 노트 색 #16794f' })).toBeInTheDocument()
})

test('노트 색으로 글자 색을 바꾸고, 기본 색으로 되돌린다', async () => {
  const editor = setup(['#16794f'])
  await userEvent.click(screen.getByRole('button', { name: /^글자 색:/ }))
  await userEvent.click(screen.getByRole('button', { name: '글자 색 노트 색 #16794f' }))
  expect(colorOf(editor)).toBe('#16794f')
  await userEvent.click(screen.getByRole('button', { name: /^글자 색:/ }))
  await userEvent.click(screen.getByRole('button', { name: '글자 색 상자 기본색' }))
  expect(colorOf(editor)).toBeUndefined()
})

test('노트 색이 없어도 기본 글자 색은 고를 수 있다', async () => {
  const editor = setup()
  await userEvent.click(screen.getByRole('button', { name: /^글자 색:/ }))
  await userEvent.click(screen.getByRole('button', { name: '글자 색 주황' }))
  expect(colorOf(editor)).toBe('#C2410C')
})
