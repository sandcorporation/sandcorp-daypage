import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as Y from 'yjs'
import { readTextBox, textBoxContent, textboxesMap, updateTextBox, type TextBox } from './doc'
import { LINE_GAP, PAGE_WIDTH } from './geometry'
import { textBoxExtensions } from './editorExtensions'
import { fontOf } from './fonts'
import { FormatBar } from './FormatBar'
import { clampBoxWidth, removeIfEmpty, shouldRemoveOnBlur, snapBoxPosition } from './textbox'
import type { ToolKind } from './tools'

/** 서식 막대의 화면 폭(px, 대략). 장 오른쪽 끝에서 잘리지 않게 자리를 정할 때 쓴다. */
const FORMAT_BAR_WIDTH = 480

type Props = {
  doc: Y.Doc
  tool: ToolKind
  scale: number
  readOnly: boolean
  origin: unknown
  /** 방금 만든 상자: 바로 입력 상태로 연다 */
  focusId: string | null
  onFocusHandled: () => void
  /** 내가 편집 중인 상자(Presence 용) */
  onEditing: (boxId: string | null) => void
  /** 다른 사람이 이어 쓰는 중인 상자 → 닉네임 목록 */
  editors: Map<string, { nickname: string; color: string }[]>
  /** 내 닉네임(내가 만든 빈 상자만 지우려고) */
  me: string
}

function useTextBoxes(doc: Y.Doc): TextBox[] {
  const [boxes, setBoxes] = useState<TextBox[]>([])
  useEffect(() => {
    const map = textboxesMap(doc)
    const read = () => setBoxes(Array.from(map.entries()).map(([id, m]) => readTextBox(id, m)))
    read()
    // 상자 속성(위치·폭) 변경만 다시 읽는다. 글 내용은 각 편집기가 직접 받는다.
    const onChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      if (events.some((e) => e.target === map || e.target.parent === map)) read()
    }
    map.observeDeep(onChange)
    return () => map.unobserveDeep(onChange)
  }, [doc])
  return boxes
}

export function TextLayer(props: Props) {
  const boxes = useTextBoxes(props.doc)
  return (
    <>
      {boxes.map((box) => (
        <TextBoxView key={box.id} box={box} {...props} />
      ))}
    </>
  )
}

type ViewProps = Props & { box: TextBox }

function TextBoxView({
  box,
  doc,
  tool,
  scale,
  readOnly,
  origin,
  focusId,
  onFocusHandled,
  onEditing,
  editors,
  me,
}: ViewProps) {
  const fragment = textBoxContent(doc, box.id)
  const [focused, setFocused] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number; width: number } | null>(null)
  // 편집기 콜백은 처음 만들 때 고정되므로 최신 값은 ref로 읽는다.
  const latest = useRef({ me, othersEditing: false })
  latest.current = { me, othersEditing: (editors.get(box.id) ?? []).length > 0 }
  const dragStart = useRef<{ kind: 'move' | 'resize'; px: number; py: number; box: TextBox } | null>(null)

  const editor = useEditor(
    {
      editable: !readOnly,
      extensions: textBoxExtensions(fragment),
      editorProps: {
        attributes: {
          class: 'textbox-editor',
          'aria-label': '글 상자',
          spellcheck: 'false',
        },
      },
      onFocus: () => {
        setFocused(true)
        onEditing(box.id)
      },
      onBlur: () => {
        setFocused(false)
        onEditing(null)
        // 내가 만든 빈 상자이고 다른 사람이 쓰고 있지 않으면 지운다.
        window.setTimeout(() => {
          const { me: mine, othersEditing } = latest.current
          if (shouldRemoveOnBlur(doc, box.id, mine, othersEditing)) removeIfEmpty(doc, box.id, origin)
        }, 0)
      },
    },
    [fragment, readOnly],
  )

  useEffect(() => {
    if (editor && focusId === box.id) {
      editor.commands.focus('end')
      onFocusHandled()
    }
  }, [editor, focusId, box.id, onFocusHandled])

  const interactive = !readOnly && (tool === 'text' || tool === 'select')
  const x = drag?.x ?? box.x
  const y = drag?.y ?? box.y
  const width = drag?.width ?? box.width
  const others = editors.get(box.id) ?? []

  function startDrag(kind: 'move' | 'resize', e: ReactPointerEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { kind, px: e.clientX, py: e.clientY, box }
    setDrag({ x: box.x, y: box.y, width: box.width })
  }

  function moveDrag(e: ReactPointerEvent<HTMLElement>) {
    const s = dragStart.current
    if (!s) return
    const dx = (e.clientX - s.px) / scale
    const dy = (e.clientY - s.py) / scale
    if (s.kind === 'move') {
      setDrag({ x: s.box.x + dx, y: s.box.y + dy, width: s.box.width })
    } else {
      setDrag({ x: s.box.x, y: s.box.y, width: clampBoxWidth(s.box.width + dx, s.box.x) })
    }
  }

  function endDrag() {
    const s = dragStart.current
    dragStart.current = null
    if (!s || !drag) return setDrag(null)
    // 클릭만 하고 움직이지 않았으면 쓰지 않는다(빈 되돌리기 단계·불필요한 전송 방지).
    if (s.kind === 'move') {
      const p = snapBoxPosition({ x: drag.x, y: drag.y }, s.box.width)
      if (p.x !== s.box.x || p.y !== s.box.y) updateTextBox(doc, box.id, { x: p.x, y: p.y }, origin)
    } else if (drag.width !== s.box.width) {
      updateTextBox(doc, box.id, { width: drag.width }, origin)
    }
    setDrag(null)
  }

  return (
    <div
      className={`textbox${focused ? ' is-focused' : ''}${interactive ? ' is-interactive' : ''}${tool === 'select' ? ' is-select' : ''}`}
      {...(interactive ? { 'data-page-ui': '' } : {})}
      style={{
        left: x,
        top: y,
        width,
        color: box.color,
        fontFamily: fontOf(box.font).family,
        fontSize: box.fontSize,
        lineHeight: `${LINE_GAP}px`,
        borderColor: others[0]?.color,
      }}
      onPointerDown={(e) => {
        if (tool === 'select' && !focused) startDrag('move', e)
      }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {others.length > 0 && (
        <span className="textbox-editing" style={{ color: others[0].color }}>
          {others.map((o) => o.nickname).join(', ')} 이어 쓰는 중
        </span>
      )}
      {focused && editor && !readOnly && <FormatBar
          editor={editor}
          scale={scale}
          below={y * scale < 56}
          alignRight={x + FORMAT_BAR_WIDTH / scale > PAGE_WIDTH}
        />}
      <EditorContent editor={editor} />
      {interactive && (
        <span
          className="textbox-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="글 상자 폭 조절"
          onPointerDown={(e) => startDrag('resize', e)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
    </div>
  )
}
