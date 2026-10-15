import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import * as Y from 'yjs'
import { addStroke, newId, readStrokes, round, strokesMap, type Stroke } from './doc'
import { PAGE_HEIGHT, PAGE_WIDTH, clampToPage, fitScale, toPagePoint, type Point } from './geometry'
import { paintStroke, paintStrokes } from './render'
import { strokeWidth, type ToolKind, type WidthLevel } from './tools'

export type PointerTool = {
  /** 이 도구가 포인터를 직접 처리하면 true를 돌려준다. */
  down?: (p: Point, e: PointerEvent<HTMLDivElement>) => boolean
  move?: (p: Point, e: PointerEvent<HTMLDivElement>) => void
  up?: (p: Point, e: PointerEvent<HTMLDivElement>) => void
}

type Props = {
  doc: Y.Doc
  tool: ToolKind
  ink: string
  widthLevel: WidthLevel
  author: string
  readOnly?: boolean
  /** 지우개·선택·글씨처럼 그리기 외 도구의 포인터 처리 */
  pointerTool?: PointerTool
  /** 내가 만든 변경에 붙는 origin(되돌리기 추적용) */
  origin?: unknown
  onPointerMove?: (p: Point | null) => void
  onScale?: (scale: number) => void
  /** 포인터를 누를 때마다 불린다(되돌리기 단위 나누기) */
  onGestureStart?: () => void
  /** 장 좌표계(1600×2400) 위에 올라가는 DOM 레이어(글 상자, 커서 등) */
  children?: ReactNode
  /** 선택 표시 등 획 위에 겹쳐 그리는 오버레이 */
  overlay?: (ctx: CanvasRenderingContext2D) => void
  overlayVersion?: number
}

export function PageView({
  doc,
  tool,
  ink,
  widthLevel,
  author,
  readOnly = false,
  pointerTool,
  origin,
  onPointerMove,
  onScale,
  onGestureStart,
  children,
  overlay,
  overlayVersion,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(0.5)
  const drawing = useRef<Stroke | null>(null)
  const pixelScale = scale * (window.devicePixelRatio || 1)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const s = fitScale(el.clientWidth)
      setScale(s)
      onScale?.(s)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onScale])

  const repaint = useCallback(() => {
    const canvas = inkCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    paintStrokes(ctx, readStrokes(doc), pixelScale)
    if (overlay) {
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
      overlay(ctx)
    }
  }, [doc, pixelScale, overlay])

  // 문서가 바뀌면 다음 프레임에 한 번만 다시 그린다.
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(repaint)
    }
    schedule()
    const strokes = strokesMap(doc)
    strokes.observeDeep(schedule)
    return () => {
      strokes.unobserveDeep(schedule)
      cancelAnimationFrame(frame)
    }
  }, [doc, repaint, overlayVersion])

  const paintLive = useCallback(() => {
    const canvas = liveCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const s = drawing.current
    if (!s) return
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
    if (s.tool === 'highlighter') ctx.globalAlpha = 0.45
    paintStroke(ctx, s)
    ctx.globalAlpha = 1
  }, [pixelScale])

  function pagePoint(e: PointerEvent<HTMLDivElement>): Point {
    const rect = frameRef.current!.getBoundingClientRect()
    return clampToPage(toPagePoint(e.clientX, e.clientY, rect, scale))
  }

  function pressure(e: { pressure: number; pointerType: string }): number {
    return e.pointerType === 'mouse' || e.pressure === 0 ? 0.5 : round(e.pressure)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (readOnly || e.button > 0) return
    // 글 상자 같은 DOM 위에서 누른 건 그 요소가 처리한다.
    if ((e.target as HTMLElement).closest('[data-page-ui]')) return
    const p = pagePoint(e)
    onGestureStart?.()
    if (tool === 'pen' || tool === 'highlighter') {
      e.currentTarget.setPointerCapture(e.pointerId)
      drawing.current = {
        id: newId(),
        tool,
        color: ink,
        width: strokeWidth(tool, widthLevel),
        points: [round(p.x), round(p.y), pressure(e)],
        author,
        createdAt: Date.now(),
      }
      paintLive()
      e.preventDefault()
      return
    }
    if (pointerTool?.down?.(p, e)) {
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const p = pagePoint(e)
    onPointerMove?.(p)
    const s = drawing.current
    if (s) {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
      const rect = frameRef.current!.getBoundingClientRect()
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const q = clampToPage(toPagePoint(ev.clientX, ev.clientY, rect, scale))
        s.points.push(round(q.x), round(q.y), pressure(ev))
      }
      paintLive()
      return
    }
    pointerTool?.move?.(p, e)
  }

  function onUp(e: PointerEvent<HTMLDivElement>) {
    const s = drawing.current
    if (s) {
      drawing.current = null
      addStroke(doc, s, origin)
      paintLive()
      return
    }
    pointerTool?.up?.(pagePoint(e), e)
  }

  const width = PAGE_WIDTH * scale
  const height = PAGE_HEIGHT * scale
  const cursor = readOnly ? 'default' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div ref={viewportRef} className="page-viewport">
      <div
        ref={frameRef}
        className="page-frame"
        style={{ width, height, cursor, touchAction: readOnly ? 'auto' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => onPointerMove?.(null)}
      >
        <div
          className="page-layer paper"
          style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}
        />
        <canvas
          ref={inkCanvasRef}
          width={Math.round(width * (window.devicePixelRatio || 1))}
          height={Math.round(height * (window.devicePixelRatio || 1))}
          style={{ width, height }}
          aria-hidden="true"
        />
        <canvas
          ref={liveCanvasRef}
          width={Math.round(width * (window.devicePixelRatio || 1))}
          height={Math.round(height * (window.devicePixelRatio || 1))}
          style={{ width, height }}
          aria-hidden="true"
        />
        <div className="page-layer" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  )
}
