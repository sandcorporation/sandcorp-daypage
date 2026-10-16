import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import * as Y from 'yjs'
import { addStroke, newId, readStrokes, round, type Stroke } from './doc'
import { PAGE_HEIGHT, PAGE_WIDTH, clampToPage, fitScale, toPagePoint, type Point } from './geometry'
import { canDrawOn, highlightPlan, layerOf, layerPlan, observeLayers, readLayers } from './layers'
import { strokeBounds, unionRect } from './hit'
import { canvasPixelRatio, paintLayers, paintStroke } from './render'
import { matrixScale, transformPoints, type Matrix } from './transform'
import { fountainPressure, strokeWidth, type Brush, type ToolKind, type WidthLevel } from './tools'
import { TouchPan, scrollNearest } from './touchPan'

export type PointerTool = {
  /** 이 도구가 포인터를 직접 처리하면 true를 돌려준다. */
  down?: (p: Point, e: PointerEvent<HTMLDivElement>) => boolean
  /** e는 스크롤로 다시 계산할 때 없다 */
  move?: (p: Point, e?: PointerEvent<HTMLDivElement>) => void
  up?: (p: Point, e: PointerEvent<HTMLDivElement>) => void
  /** 누르지 않고 올려만 둔 위치에서 보일 커서(손잡이 등). null이면 도구 기본 커서. p가 null이면 지면을 벗어났다. */
  hover?: (p: Point | null) => string | null
}

type Props = {
  doc: Y.Doc
  tool: ToolKind
  ink: string
  widthLevel: WidthLevel
  /** 펜 종류(펜일 때만 쓴다) */
  brush?: Brush
  /** 필압 따라 굵기 바꾸기. 끄면 굵기가 일정한 획을 그린다 */
  pressureOn?: boolean
  /** 새 획을 넣을 레이어(지금 그리는 레이어) */
  layer?: string
  /** 내 화면에서만 숨긴 레이어 */
  hiddenLayers?: ReadonlySet<string>
  /** 레이어 탭에서 고르거나 올린 레이어: 나머지는 흐리게, 이 레이어는 이름표 달린 상자로 표시 */
  highlightLayer?: string | null
  /** 지금 그리는 레이어가 잠겼거나 내가 숨겨 그리지 못했을 때 */
  onDrawBlocked?: (reason: 'locked' | 'hidden') => void
  author: string
  readOnly?: boolean
  /** 지우개·선택·글씨처럼 그리기 외 도구의 포인터 처리 */
  pointerTool?: PointerTool
  /** 내가 만든 변경에 붙는 origin(되돌리기 추적용) */
  origin?: unknown
  onPointerMove?: (p: Point | null) => void
  onScale?: (scale: number) => void
  /** 'fit'이면 화면 폭에 맞추고, 숫자면 그 배율로 보인다(넘치면 가로 스크롤) */
  zoom?: 'fit' | number
  /** 포인터를 누를 때마다 불린다(되돌리기 단위 나누기) */
  onGestureStart?: () => void
  /** 장 좌표계(1600×2400) 위에 올라가는 DOM 레이어(글 상자, 커서 등) */
  children?: ReactNode
  /** 선택 표시 등 획 위에 겹쳐 그리는 오버레이 */
  overlay?: (ctx: CanvasRenderingContext2D) => void
  overlayVersion?: number
  /** 끄는 중인 획을 문서에 쓰기 전에 옮겨 보여 준다(놓을 때 한 번만 저장) */
  preview?: { ids: string[]; m: Matrix } | null
}

export function PageView({
  doc,
  tool,
  ink,
  widthLevel,
  brush,
  pressureOn = true,
  layer,
  hiddenLayers,
  highlightLayer,
  onDrawBlocked,
  author,
  readOnly = false,
  pointerTool,
  origin,
  onPointerMove,
  onScale,
  onGestureStart,
  zoom = 'fit',
  children,
  overlay,
  overlayVersion,
  preview,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(0.5)
  const drawing = useRef<Stroke | null>(null)
  // 손잡이 등에 올렸을 때의 커서(어느 도구가 정했는지와 함께)
  const [hover, setHover] = useState<{ tool?: PointerTool; cursor: string | null }>({ cursor: null })
  // 만년필: 앞 점의 위치·시각·필압(속도로 필압을 만들 때 쓴다)
  const lastSample = useRef<{ x: number; y: number; t: number; p: number } | null>(null)
  // 지금 처리 중인 포인터. 두 번째 손가락·손바닥이 한 획에 섞이지 않게 한다.
  const activePointer = useRef<number | null>(null)
  // 마지막 포인터 화면 위치. 누른 채 스크롤하면 이 위치로 장 좌표를 다시 계산한다.
  const lastClient = useRef<{ x: number; y: number } | null>(null)
  // 터치: 한 손가락은 그리기(도구 동작), 두 손가락은 스크롤
  const touchPan = useRef(new TouchPan())
  const dpr = canvasPixelRatio(PAGE_WIDTH * scale, PAGE_HEIGHT * scale, window.devicePixelRatio || 1)
  const pixelScale = scale * dpr

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const s = zoom === 'fit' ? fitScale(el.clientWidth) : zoom
      setScale(s)
      onScale?.(s)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onScale, zoom])

  const repaint = useCallback(() => {
    const canvas = inkCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let strokes = readStrokes(doc)
    if (preview) {
      const moving = new Set(preview.ids)
      const k = matrixScale(preview.m)
      strokes = strokes.map((st) =>
        moving.has(st.id) ? { ...st, points: transformPoints(st.points, preview.m), width: st.width * k } : st,
      )
    }
    const layers = readLayers(doc)
    paintLayers(ctx, highlightPlan(layerPlan(strokes, layers, hiddenLayers), highlightLayer), pixelScale)
    const target = highlightLayer ? layers.find((l) => l.id === highlightLayer) : undefined
    if (target) {
      const box = unionRect(strokes.filter((s) => layerOf(s, layers) === target.id).map(strokeBounds))
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
      paintLayerTag(ctx, box, target.name, scale)
    }
    if (overlay) {
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
      overlay(ctx)
    }
  }, [doc, pixelScale, overlay, preview, hiddenLayers, highlightLayer, scale])

  // 문서가 바뀌면 다음 프레임에 한 번만 다시 그린다.
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(repaint)
    }
    schedule()
    const unobserve = observeLayers(doc, schedule)
    return () => {
      unobserve()
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

  /** 점의 필압 값. 필압을 끄면 고정값, 만년필을 필압 없는 입력으로 쓰면 속도로 만든다. */
  function pressure(e: { pressure: number; pointerType: string; timeStamp: number }, q: Point): number {
    const real = e.pointerType !== 'mouse' && e.pressure !== 0
    let value = 0.5
    if (!pressureOn) value = 0.5
    else if (real && (e.pointerType === 'pen' || brush !== 'fountain')) value = round(e.pressure)
    else if (tool === 'pen' && brush === 'fountain') {
      const last = lastSample.current
      value = last ? fountainPressure(last.p, Math.hypot(q.x - last.x, q.y - last.y), e.timeStamp - last.t) : 0.6
    }
    lastSample.current = { x: q.x, y: q.y, t: e.timeStamp, p: value }
    return value
  }

  /** 두 번째 손가락이 닿으면 막 시작한 획은 버리고, 다른 도구 동작은 그 자리에서 끝낸다. */
  function cancelGesture(e: PointerEvent<HTMLDivElement>) {
    if (activePointer.current === null) return
    activePointer.current = null
    if (drawing.current) {
      drawing.current = null
      paintLive()
      return
    }
    const c = lastClient.current
    const frame = frameRef.current
    if (c && frame) pointerTool?.up?.(clampToPage(toPagePoint(c.x, c.y, frame.getBoundingClientRect(), scale)), e)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (readOnly || e.button > 0) return
    if (e.pointerType === 'touch') {
      const pan = touchPan.current
      if (pan.down(e.pointerId, e.clientX, e.clientY)) cancelGesture(e)
      if (pan.active) {
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }
    }
    // 글 상자 같은 DOM 위에서 누른 건 그 요소가 처리한다.
    if ((e.target as HTMLElement).closest('[data-page-ui]')) return
    if (activePointer.current !== null) return
    lastClient.current = { x: e.clientX, y: e.clientY }
    const p = pagePoint(e)
    onGestureStart?.()
    if (tool === 'pen' || tool === 'highlighter') {
      if (layer && !canDrawOn(readLayers(doc), layer)) {
        onDrawBlocked?.('locked')
        return
      }
      if (layer && hiddenLayers?.has(layer)) {
        // 숨긴 레이어에 그리면 손을 떼는 순간 내 화면에서 사라진다
        onDrawBlocked?.('hidden')
        return
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      activePointer.current = e.pointerId
      lastSample.current = null
      const firstPressure = pressure(e, p)
      drawing.current = {
        id: newId(),
        tool,
        color: ink,
        width: strokeWidth(tool, widthLevel),
        points: [round(p.x), round(p.y), firstPressure],
        author,
        createdAt: Date.now(),
        ...(tool === 'pen' && brush ? { brush } : {}),
        ...(tool === 'pen' && !pressureOn ? { steady: true } : {}),
        ...(layer ? { layer } : {}),
      }
      paintLive()
      e.preventDefault()
      return
    }
    if (pointerTool?.down?.(p, e)) {
      e.currentTarget.setPointerCapture(e.pointerId)
      activePointer.current = e.pointerId
      e.preventDefault()
    }
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') {
      const d = touchPan.current.move(e.pointerId, e.clientX, e.clientY)
      if (touchPan.current.active) {
        if (d && frameRef.current) scrollNearest(frameRef.current, -d.dx, -d.dy)
        return
      }
    }
    if (activePointer.current !== null && e.pointerId !== activePointer.current) return
    lastClient.current = { x: e.clientX, y: e.clientY }
    const p = pagePoint(e)
    onPointerMove?.(p)
    const s = drawing.current
    if (s) {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
      const rect = frameRef.current!.getBoundingClientRect()
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const q = clampToPage(toPagePoint(ev.clientX, ev.clientY, rect, scale))
        s.points.push(round(q.x), round(q.y), pressure(ev, q))
      }
      paintLive()
      return
    }
    if (activePointer.current === null) updateHover(p)
    else pointerTool?.move?.(p, e)
  }

  /** 올려 둔 위치의 커서를 도구에게 묻는다. 바뀔 때만 다시 그린다. */
  function updateHover(p: Point | null) {
    if (!pointerTool?.hover) return
    const cursor = pointerTool.hover(p)
    if (hover.tool !== pointerTool || hover.cursor !== cursor) setHover({ tool: pointerTool, cursor })
  }

  function onUp(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') touchPan.current.up(e.pointerId)
    if (e.pointerId !== activePointer.current) return
    activePointer.current = null
    const s = drawing.current
    if (s) {
      drawing.current = null
      addStroke(doc, s, origin)
      paintLive()
      return
    }
    pointerTool?.up?.(pagePoint(e), e)
  }

  // 끄는 중(선택 이동·사각형 선택·지우개)에 스크롤하면 포인터 아래의 새 장 위치로 이어 간다.
  useEffect(() => {
    const onScroll = () => {
      const c = lastClient.current
      const frame = frameRef.current
      if (!c || !frame) return
      const p = clampToPage(toPagePoint(c.x, c.y, frame.getBoundingClientRect(), scale))
      onPointerMove?.(p)
      if (activePointer.current !== null && !drawing.current) pointerTool?.move?.(p)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [scale, pointerTool, onPointerMove])

  const width = PAGE_WIDTH * scale
  // 도구가 바뀌면 이전 도구의 커서는 버린다(같은 도구일 때만 쓴다)
  const hoverCursor = hover.tool === pointerTool ? hover.cursor : null
  const height = PAGE_HEIGHT * scale
  const cursor =
    hoverCursor ?? (readOnly ? 'default' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair')

  return (
    <div ref={viewportRef} className="page-viewport">
      <div
        ref={frameRef}
        className="page-frame"
        style={{ width, height, cursor, touchAction: readOnly || tool === 'select' ? 'pan-x pan-y' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => {
          lastClient.current = null
          onPointerMove?.(null)
          if (activePointer.current === null) updateHover(null)
        }}
      >
        <div
          className="page-layer paper"
          style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}
        />
        <canvas
          ref={inkCanvasRef}
          width={Math.round(width * dpr)}
          height={Math.round(height * dpr)}
          style={{ width, height }}
          aria-hidden="true"
        />
        <canvas
          ref={liveCanvasRef}
          width={Math.round(width * dpr)}
          height={Math.round(height * dpr)}
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

/** 강조한 레이어 둘레의 점선 상자와 이름표(장 좌표로 그린다, 화면에서 일정한 크기). 획이 없으면 그리지 않는다. */
function paintLayerTag(ctx: CanvasRenderingContext2D, box: { x: number; y: number; width: number; height: number } | null, name: string, scale: number) {
  if (!box) return
  const px = (v: number) => v / scale
  const pad = px(10)
  const x = box.x - pad
  const y = box.y - pad
  const w = box.width + pad * 2
  const h = box.height + pad * 2
  ctx.save()
  ctx.strokeStyle = '#2A47B0'
  ctx.lineWidth = px(2)
  ctx.setLineDash([px(6), px(4)])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.font = `600 ${px(13)}px 'Gothic A1', sans-serif`
  const tw = ctx.measureText(name).width + px(14)
  const th = px(22)
  // 이름표는 오른쪽 위(레이어 창은 왼쪽에 뜬다). 위쪽에 자리가 없으면 상자 안쪽 위에 붙인다
  const tx = x + w - tw
  const ty = y - th < 0 ? y : y - th
  ctx.fillStyle = '#2A47B0'
  ctx.fillRect(tx, ty, tw, th)
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, tx + px(7), ty + th / 2)
  ctx.restore()
}
