import { useEditorState, type Editor } from '@tiptap/react'
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { TEXT_COLORS, TEXT_SIZES } from './editorExtensions'
import { resolveFontSize } from './textStyle'

// 누르는 동안 편집기의 선택·포커스를 지킨다.
const keep = (e: PointerEvent) => e.preventDefault()

const EDGE = 8

/** 요소가 보일 수 있는 가로 범위: 화면과, 넘침을 잘라 내는 조상들이 겹친 영역 */
function visibleBounds(el: HTMLElement) {
  let left = EDGE
  let right = window.innerWidth - EDGE
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflowX === 'visible') continue
    const r = p.getBoundingClientRect()
    left = Math.max(left, r.left + EDGE)
    right = Math.min(right, r.right - EDGE)
  }
  return { left, right }
}

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
  /** 노트 색(#rrggbb). 기본 글자 색 뒤에 붙는다 */
  noteColors?: string[]
  /** 상자 기본 글자 크기(px). 작게·크게 비율과 px 조절의 기준 */
  baseSize?: number
}

/** 글자 크기를 px로 정할 때의 범위와 한 번에 바꾸는 양 */
const TEXT_PX_MIN = 10
const TEXT_PX_MAX = 72
const TEXT_PX_STEP = 2

/** 편집 중인 글 상자 위에 뜨는 서식 막대. 장 레이어의 축소를 거꾸로 키워 화면에서 일정한 크기로 보인다. */
export function FormatBar({ editor, scale, below = false, alignRight = false, noteColors = [], baseSize = 28 }: Props) {
  const [colorsOpen, setColorsOpen] = useState(false)
  const colorsRef = useRef<HTMLSpanElement>(null)
  // 펼친 색 줄이 보이는 범위 밖으로 나가면 안쪽으로 민다(넓으면 왼쪽 끝을 맞춘다).
  useLayoutEffect(() => {
    const el = colorsRef.current
    if (!colorsOpen || !el) return
    el.style.translate = ''
    const r = el.getBoundingClientRect()
    const b = visibleBounds(el)
    const dx = r.right > b.right ? Math.max(b.right - r.right, b.left - r.left) : r.left < b.left ? b.left - r.left : 0
    if (dx) el.style.translate = `${dx}px 0`
  }, [colorsOpen, noteColors.length])
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
  // 지금 글자 크기(px). 마크가 없으면 상자 기본 크기
  const px = resolveFontSize(baseSize, state.fontSize)
  const setPx = (next: number) => () => {
    const v = Math.min(TEXT_PX_MAX, Math.max(TEXT_PX_MIN, next))
    editor.chain().focus().setFontSize(`${v}px`).run()
  }
  // 색을 고르면 펼친 색 줄을 닫는다. null이면 상자 기본색으로 되돌린다.
  const pickColor = (color: string | null) => () => {
    if (color === null) editor.chain().focus().unsetColor().run()
    else editor.chain().focus().setColor(color).run()
    setColorsOpen(false)
  }
  const colorName = (color: string | null) =>
    color === null
      ? '상자 기본색'
      : (TEXT_COLORS.find((c) => c.color.toLowerCase() === color.toLowerCase())?.name ?? '노트 색 ' + color.toLowerCase())

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
      <span className="format-color">
        <button
          type="button"
          className="format-btn"
          aria-label={`글자 색: ${colorName(state.color)}`}
          title="글자 색"
          aria-expanded={colorsOpen}
          onPointerDown={keep}
          onClick={() => setColorsOpen((v) => !v)}
        >
          <span
            className={`format-swatch${state.color ? '' : ' default'}`}
            style={state.color ? { background: state.color } : undefined}
          />
        </button>
        {colorsOpen && (
          <span ref={colorsRef} className="format-colors" role="group" aria-label="글자 색">
            <button
              type="button"
              className="format-btn"
              aria-label="글자 색 상자 기본색"
              title="상자 기본색"
              aria-pressed={state.color === null}
              onPointerDown={keep}
              onClick={pickColor(null)}
            >
              <span className="format-swatch default" />
            </button>
            {[...TEXT_COLORS.map((c) => ({ label: c.name, color: c.color as string })), ...noteColors.map((c) => ({ label: `노트 색 ${c}`, color: c }))].map(
              (c) => (
                <button
                  key={c.color}
                  type="button"
                  className="format-btn"
                  aria-label={`글자 색 ${c.label}`}
                  title={`글자 색 ${c.label}`}
                  aria-pressed={state.color?.toLowerCase() === c.color.toLowerCase()}
                  onPointerDown={keep}
                  onClick={pickColor(c.color)}
                >
                  <span className="format-swatch" style={{ background: c.color }} />
                </button>
              ),
            )}
          </span>
        )}
      </span>
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
      {/* px로 직접: 지금 크기에서 2px씩 */}
      <span className="format-px">
        <button
          type="button"
          className="format-btn"
          aria-label="글자 크기 2px 작게"
          title="글자 크기 2px 작게"
          disabled={px <= TEXT_PX_MIN}
          onPointerDown={keep}
          onClick={setPx(px - TEXT_PX_STEP)}
        >
          −
        </button>
        <span className="format-px-value" title="글자 크기(px)">
          {px}px
        </span>
        <button
          type="button"
          className="format-btn"
          aria-label="글자 크기 2px 크게"
          title="글자 크기 2px 크게"
          disabled={px >= TEXT_PX_MAX}
          onPointerDown={keep}
          onClick={setPx(px + TEXT_PX_STEP)}
        >
          +
        </button>
      </span>
    </div>
  )
}
