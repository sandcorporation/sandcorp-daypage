import { useEditorState, type Editor } from '@tiptap/react'
import type { PointerEvent } from 'react'
import { TEXT_COLORS, TEXT_SIZES } from './editorExtensions'

// 누르는 동안 편집기의 선택·포커스를 지킨다.
const keep = (e: PointerEvent) => e.preventDefault()

const MARKS = [
  { mark: 'bold', label: '굵게', short: 'Ctrl+B', glyph: 'B', style: { fontWeight: 800 } },
  { mark: 'italic', label: '기울임', short: 'Ctrl+I', glyph: 'I', style: { fontStyle: 'italic', fontFamily: 'serif' } },
  { mark: 'underline', label: '밑줄', short: 'Ctrl+U', glyph: 'U', style: { textDecoration: 'underline' } },
  { mark: 'strike', label: '취소선', short: 'Ctrl+Shift+X', glyph: 'S', style: { textDecoration: 'line-through' } },
] as const

type Props = {
  editor: Editor
  scale: number
  /** 상자가 장 위쪽 끝에 붙어 있으면 아래에 띄운다 */
  below?: boolean
  /** 상자가 장 오른쪽 끝에 가까우면 오른쪽에 맞춘다 */
  alignRight?: boolean
}

/** 편집 중인 글 상자 위에 뜨는 서식 막대. 장 레이어의 축소를 거꾸로 키워 화면에서 일정한 크기로 보인다. */
export function FormatBar({ editor, scale, below = false, alignRight = false }: Props) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      fontSize: (e.getAttributes('textStyle').fontSize as string | undefined) ?? null,
    }),
  })

  const run = (fn: () => void) => () => fn()

  return (
    <div
      className={`format-bar${below ? ' below' : ''}${alignRight ? ' align-right' : ''}`}
      role="toolbar"
      aria-label="글자 서식"
      style={{ transform: `scale(${1 / scale})` }}
      onPointerDown={(e) => {
        keep(e)
        e.stopPropagation()
      }}
    >
      {MARKS.map((m) => (
        <button
          key={m.mark}
          type="button"
          className="format-btn"
          aria-label={m.label}
          title={`${m.label} (${m.short})`}
          aria-pressed={state[m.mark]}
          onPointerDown={keep}
          onClick={run(() => editor.chain().focus().toggleMark(m.mark).run())}
        >
          <span style={m.style}>{m.glyph}</span>
        </button>
      ))}
      <span className="format-sep" />
      {TEXT_COLORS.map((c) => (
        <button
          key={c.color}
          type="button"
          className="format-btn"
          aria-label={`글자 색 ${c.name}`}
          title={`글자 색 ${c.name}`}
          aria-pressed={state.color === c.color}
          onPointerDown={keep}
          onClick={run(() =>
            state.color === c.color
              ? editor.chain().focus().unsetColor().run()
              : editor.chain().focus().setColor(c.color).run(),
          )}
        >
          <span className="format-swatch" style={{ background: c.color }} />
        </button>
      ))}
      <span className="format-sep" />
      {TEXT_SIZES.map((s) => (
        <button
          key={s.id}
          type="button"
          className="format-btn format-size"
          aria-label={`글자 크기 ${s.label}`}
          title={`글자 크기 ${s.label}`}
          aria-pressed={state.fontSize === s.value}
          onPointerDown={keep}
          onClick={run(() =>
            s.value === null
              ? editor.chain().focus().unsetFontSize().run()
              : editor.chain().focus().setFontSize(s.value).run(),
          )}
        >
          <span style={{ fontSize: s.id === 'small' ? 11 : s.id === 'large' ? 17 : 14 }}>가</span>
        </button>
      ))}
    </div>
  )
}
