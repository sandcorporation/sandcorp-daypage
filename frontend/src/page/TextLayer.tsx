import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import * as Y from 'yjs'
import { readTextBox, textBoxContent, textboxesMap, updateTextBox, type TextBox } from './doc'
import { LINE_GAP, PAGE_WIDTH, pageDelta } from './geometry'
import { textBoxExtensions } from './editorExtensions'
import { fontOf } from './fonts'
import { CharCounter } from './CharCounter'
import { FormatBar } from './FormatBar'
import { clampBoxWidth, fitBoxInPage, nudgeBox, removeIfEmpty, shouldRemoveOnBlur, snapBoxPosition } from './textbox'
import type { ToolKind } from './tools'
import { PAN_START_EVENT } from './touchPan'
import type { EditPreview } from './useEditTools'

/** 서식 막대의 화면 폭(px, 대략). 장 오른쪽 끝에서 잘리지 않게 자리를 정할 때 쓴다. */
const FORMAT_BAR_WIDTH = 480
/** '○○ 이어 쓰는 중'이 상자 오른쪽에 들어갈 화면 폭(px, 대략) */
const EDITING_LABEL_ROOM = 170

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
  /** 노트 색: 서식 막대의 글자 색에 함께 보인다 */
  noteColors?: string[]
  /** 선택 도구로 고른 글 상자(테두리로 보인다) */
  selectedTexts?: readonly string[]
  /** 선택 도구로 묶음을 끄는 동안의 미리보기: 고른 글 상자를 같은 만큼 옮겨 보인다 */
  editPreview?: EditPreview
}

const noSubscribe = () => () => {}

/** 끄는 동안 이 상자가 옮겨 보일 거리. 문자열이라 같은 값이면 다시 그리지 않는다. */
function usePreviewOffset(preview: EditPreview | undefined, id: string): { dx: number; dy: number } {
  const subscribe = useCallback((fn: () => void) => (preview ? preview.subscribe(fn) : noSubscribe()), [preview])
  const key = useSyncExternalStore(subscribe, () => {
    const mv = preview?.move
    return mv && mv.texts.includes(id) ? `${mv.m[4]},${mv.m[5]}` : ''
  })
  if (!key) return { dx: 0, dy: 0 }
  const [dx, dy] = key.split(',').map(Number)
  return { dx, dy }
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
  noteColors,
  selectedTexts,
  editPreview,
}: ViewProps) {
  const offset = usePreviewOffset(editPreview, box.id)
  const picked = tool === 'select' && !!selectedTexts?.includes(box.id)
  const fragment = textBoxContent(doc, box.id)
  const [focused, setFocused] = useState(false)
  // 서식 막대는 옮기기 손잡이를 (끌지 않고) 눌렀을 때만 연다.
  const [formatOpen, setFormatOpen] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number; width: number } | null>(null)
  // 편집기 콜백은 처음 만들 때 고정되므로 최신 값은 ref로 읽는다.
  const latest = useRef({ me, othersEditing: false })
  latest.current = { me, othersEditing: (editors.get(box.id) ?? []).length > 0 }
  const rootRef = useRef<HTMLDivElement>(null)
  type DragStart = {
    kind: 'move' | 'resize'
    client: { x: number; y: number }
    rect: { left: number; top: number }
    box: TextBox
    /** 마지막 포인터 위치(스크롤만 일어났을 때 다시 계산하려고) */
    last: { x: number; y: number }
    moved: number
    /** 포인터를 잡은 요소와 그 포인터(거둘 때 놓아 주려고) */
    target: HTMLElement
    pointerId: number
  }
  const dragStart = useRef<DragStart | null>(null)

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
        setFormatOpen(false)
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
  // 상자가 포인터를 직접 받는지. 선택 도구에서는 몸통을 누르면 지면(선택 도구)이 고르고 옮긴다(다른 획·글 상자와 섞어 고르게).
  // 손잡이·폭 조절은 늘 상자가 처리한다.
  const ownsPointer = interactive && (tool !== 'select' || focused)

  // 내가 쓰는 동안 줄이 늘어 장 아래로 넘치면 상자를 칸 단위로 끌어올린다.
  // (장 밖은 잘려서 다른 사람에게 보이지 않는다. 옮긴 위치는 동기화된다.)
  useEffect(() => {
    const content = rootRef.current?.querySelector<HTMLElement>('.textbox-editor')
    if (!focused || readOnly || !content) return
    const check = () => {
      const next = fitBoxInPage(box.y, content.offsetHeight)
      if (next !== box.y) updateTextBox(doc, box.id, { y: next }, origin)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(content)
    return () => observer.disconnect()
  }, [focused, readOnly, box.y, box.id, doc, origin])
  useEffect(() => {
    if (!interactive) setFormatOpen(false)
  }, [interactive])

  function toggleFormat() {
    if (!editor || readOnly) return
    setFormatOpen((open) => {
      // 서식은 편집기에 적용되므로, 열 때 아직 편집 중이 아니면 편집을 시작한다.
      if (!open && !editor.isFocused) editor.commands.focus('end')
      return !open
    })
  }
  const x = (drag?.x ?? box.x) + offset.dx
  const y = (drag?.y ?? box.y) + offset.dy
  const width = drag?.width ?? box.width
  const others = editors.get(box.id) ?? []
  // 아무도 쓰지 않는 빈 상자는 보이지 않게 둔다(나갔다 들어와 남은 상자 등).
  // 포커스는 받을 수 있어야 하므로 visibility 대신 투명도로 숨긴다.
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? false })
  const idleEmpty = empty && !focused && focusId !== box.id && others.length === 0 && !drag

  function frameRect(): { left: number; top: number } {
    const frame = rootRef.current?.closest('.page-frame')
    const r = frame?.getBoundingClientRect()
    return { left: r?.left ?? 0, top: r?.top ?? 0 }
  }

  /** 장 기준으로 끄는 위치를 다시 잡는다. 누른 채 스크롤해도 포인터를 따라간다. */
  function applyDrag() {
    const s = dragStart.current
    if (!s) return
    const { dx, dy } = pageDelta(s.client, s.rect, s.last, frameRect(), scale)
    s.moved = Math.max(s.moved, Math.hypot(dx, dy) * scale)
    if (s.kind === 'move') setDrag({ x: s.box.x + dx, y: s.box.y + dy, width: s.box.width })
    else setDrag({ x: s.box.x, y: s.box.y, width: clampBoxWidth(s.box.width + dx, s.box.x) })
  }

  // 끄는 동안 일어난 스크롤(창·장 가로 스크롤 모두)에도 위치를 다시 잡는다.
  // 손가락 스크롤·핀치가 시작되면(지면이 PAN_START_EVENT를 띄운다) 끌기를 거둔다.
  useEffect(() => {
    if (!drag) return
    const onScroll = () => applyDrag()
    const frame = rootRef.current?.closest('.page-frame')
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    frame?.addEventListener(PAN_START_EVENT, cancelDrag)
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      frame?.removeEventListener(PAN_START_EVENT, cancelDrag)
    }
  })

  function startDrag(kind: 'move' | 'resize', e: ReactPointerEvent<HTMLElement>) {
    e.preventDefault()
    // 손가락은 지면(PageView)에도 알린다: 두 번째 손가락이 닿으면 지면이 스크롤·핀치를 맡고 우리는 끌기를 거둔다.
    if (e.pointerType !== 'touch') e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const client = { x: e.clientX, y: e.clientY }
    dragStart.current = { kind, client, rect: frameRect(), box, last: client, moved: 0, target: e.currentTarget, pointerId: e.pointerId }
    setDrag({ x: box.x, y: box.y, width: box.width })
  }

  /** 끌기를 결과 없이 거둔다(손가락 스크롤이 시작됐거나 브라우저가 포인터를 가져갔을 때). */
  function cancelDrag() {
    const s = dragStart.current
    dragStart.current = null
    setDrag(null)
    if (!s) return
    try {
      s.target.releasePointerCapture(s.pointerId)
    } catch {
      // 이미 놓였으면 그만
    }
  }

  function moveDrag(e: ReactPointerEvent<HTMLElement>) {
    const s = dragStart.current
    if (!s) return
    s.last = { x: e.clientX, y: e.clientY }
    applyDrag()
  }

  /** 끌기를 마친다. 손잡이를 끌지 않고 눌렀다 뗐으면 true(클릭으로 본다). */
  function endDrag(e?: ReactPointerEvent<HTMLElement>): boolean {
    const s = dragStart.current
    dragStart.current = null
    setDrag(null)
    if (!s) return false
    if (e) s.last = { x: e.clientX, y: e.clientY }
    // 놓는 순간의 위치를 장 기준으로 직접 계산한다(렌더 상태는 한 박자 늦을 수 있다).
    const { dx, dy } = pageDelta(s.client, s.rect, s.last, frameRect(), scale)
    const moved = Math.max(s.moved, Math.hypot(dx, dy) * scale)
    // 장 위에서 거의 움직이지 않았으면 클릭으로 보고 쓰지 않는다(스크롤로 옮겨진 것도 움직인 것).
    if (moved < 4) return !!e
    if (s.kind === 'move') {
      const p = snapBoxPosition({ x: s.box.x + dx, y: s.box.y + dy }, s.box.width)
      if (p.x !== s.box.x || p.y !== s.box.y) updateTextBox(doc, box.id, { x: p.x, y: p.y }, origin)
    } else {
      const width = clampBoxWidth(s.box.width + dx, s.box.x)
      if (width !== s.box.width) updateTextBox(doc, box.id, { width }, origin)
    }
    return false
  }

  return (
    <div
      className={`textbox${focused ? ' is-focused' : ''}${interactive ? ' is-interactive' : ''}${tool === 'select' ? ' is-select' : ''}${picked ? ' is-picked' : ''}${idleEmpty ? ' is-idle-empty' : ''}`}
      ref={rootRef}
      data-box-id={box.id}
      {...(ownsPointer ? { 'data-page-ui': '' } : {})}
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
      onPointerMove={moveDrag}
      onPointerUp={(e) => void endDrag(e)}
      onPointerCancel={cancelDrag}
    >
      {others.length > 0 && (
        <span
          className={`textbox-editing${x + width + EDITING_LABEL_ROOM / scale > PAGE_WIDTH ? ' below' : ''}`}
          style={{ color: others[0].color, transform: `scale(${1 / scale})` }}
        >
          {others.map((o) => o.nickname).join(', ')} 이어 쓰는 중
        </span>
      )}
      {formatOpen && editor && !readOnly && <FormatBar
          editor={editor}
          scale={scale}
          below={y * scale < 56}
          alignRight={x + FORMAT_BAR_WIDTH / scale > PAGE_WIDTH}
          noteColors={noteColors}
          baseSize={box.fontSize}
        />}
      {interactive && (
        <button
          type="button"
          className={`textbox-grip${x * scale < 36 ? ' inside' : ''}`}
          data-page-ui=""
          aria-label="글 상자 옮기기·서식 (끌어서 옮기기, 눌러서 서식)"
          title="끌어서 옮기기 · 눌러서 서식 · 화살표 키로 한 칸씩"
          style={{ transform: `scale(${1 / scale})` }}
          aria-expanded={formatOpen}
          onPointerDown={(e) => startDrag('move', e)}
          onPointerMove={moveDrag}
          onPointerUp={(e) => {
            if (endDrag(e)) toggleFormat()
          }}
          onPointerCancel={cancelDrag}
          onClick={(e) => {
            // 키보드(Enter·Space)로 누른 경우. 마우스·터치는 pointerup에서 처리한다.
            if (e.detail === 0) toggleFormat()
          }}
          onKeyDown={(e) => {
            const next = nudgeBox(box, e.key)
            if (!next) return
            e.preventDefault()
            if (next.x !== box.x || next.y !== box.y) updateTextBox(doc, box.id, next, origin)
          }}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
            {[3, 8, 13].flatMap((cy) => [2, 8].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill="currentColor" />))}
          </svg>
        </button>
      )}
      <EditorContent editor={editor} />
      {focused && editor && !readOnly && <CharCounter editor={editor} scale={scale} />}
      {interactive && (
        <span
          className="textbox-handle"
          data-page-ui=""
          style={{ transform: `scale(${1 / scale})` }}
          role="separator"
          aria-orientation="vertical"
          aria-label="글 상자 폭 조절"
          onPointerDown={(e) => startDrag('resize', e)}
          onPointerMove={moveDrag}
          onPointerUp={(e) => void endDrag(e)}
          onPointerCancel={cancelDrag}
        />
      )}
    </div>
  )
}
