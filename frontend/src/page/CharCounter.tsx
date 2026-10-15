import { useEditorState, type Editor } from '@tiptap/react'
import { TEXT_LIMIT } from './textLimit'

const SHOW_FROM = 900

/** 글이 한도에 가까워지면 상자 아래에 '글자 수/1000'을 보여 준다. */
export function CharCounter({ editor, scale }: { editor: Editor; scale: number }) {
  const count = useEditorState({ editor, selector: ({ editor: e }) => e.state.doc.textContent.length })
  if (count < SHOW_FROM) return null
  const full = count >= TEXT_LIMIT
  return (
    <span
      className={`char-counter${full ? ' is-full' : ''}`}
      style={{ transform: `scale(${1 / scale})` }}
      aria-live="polite"
    >
      {count}/{TEXT_LIMIT}
      {full ? ' · 더 쓸 수 없어요' : ''}
    </span>
  )
}
