import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent, type ReactNode } from 'react'
import * as Y from 'yjs'
import { addStroke, newId, readStroke, readStrokes, round, strokesMap, type Stroke } from './doc'
import { PAGE_HEIGHT, PAGE_WIDTH, clampToPage, fitScale, toPagePoint, type Point } from './geometry'
import { canDrawOn, DIM, highlightPlan, layerOf, layerPlan, layersMap, readLayers } from './layers'
import { strokeBounds, unionRect } from './hit'
import { canvasPixelRatio, fillPath, paintColorStrokes, paintLayers, paintOpacity, paintStroke, paintStrokes, softRadius } from './render'
import { appendPlan, paintedAfter, type Painted } from './inkCache'
import { matrixScale, transformPoints, type Matrix } from './transform'
import { getKeymap, matches } from './shortcuts'
import { DEFAULT_PAINT_OPACITY, fountainPressure, strokeWidth, type Brush, type ToolKind, type WidthLevel } from './tools'
import { PAN_START_EVENT, TouchPan, scrollNearest } from './touchPan'
import { straightPoints } from './straight'
import { DEFAULT_SHAPE, closedShape, curvePoints, densify, shapePoints, type ShapeKind } from './shapes'
import { DEFAULT_PAPER, paperPalette, paperStyle, type Paper } from './paper'
import { anchorAt, fitScaleIn, isPanButton, pinchZoom, scrollAfterZoom, wheelZoom, type ClientPoint, type ZoomAnchor } from './viewport'

/** 곡선: 첫 점·직전 점에서 이만큼(화면 px) 안을 누르면 닫기·끝내기로 본다 */
const CURVE_SNAP_PX = 22
/** 곡선: 이 시간(ms) 안에 같은 자리를 다시 누르면 두 번 누르기 */
const DOUBLE_TAP_MS = 400
/** 펜슬 터치 이벤트로 긋는 획의 activePointer(포인터 id는 0 이상이라 겹치지 않는다) */
const STYLUS_POINTER = -1

type InkTool = 'pen' | 'highlighter' | 'paint'
const inkTool = (tool: ToolKind): tool is InkTool => tool === 'pen' || tool === 'highlighter' || tool === 'paint'
type PressureSample = { pressure: number; pointerType: string; timeStamp: number }

export type PointerTool = {
  /** 이 도구가 포인터를 직접 처리하면 true를 돌려준다. */
  down?: (p: Point, e: PointerEvent<HTMLDivElement>) => boolean
  /** e는 스크롤로 다시 계산할 때 없다 */
  move?: (p: Point, e?: PointerEvent<HTMLDivElement>) => void
  up?: (p: Point, e: PointerEvent<HTMLDivElement>) => void
  /** 동작을 결과 없이 거둔다(두 번째 손가락이 닿아 스크롤로 바뀔 때). 없으면 그 자리에서 up으로 끝낸다. */
  cancel?: () => void
  /** 누르지 않고 올려만 둔 위치에서 보일 커서(손잡이 등). null이면 도구 기본 커서. p가 null이면 지면을 벗어났다. */
  hover?: (p: Point | null) => string | null
}

type Props = {
  doc: Y.Doc
  tool: ToolKind
  ink: string
  widthLevel: WidthLevel
  /** 직접 정한 굵기(px). 있으면 단계 대신 쓴다 */
  customWidth?: number | null
  /** 채색 붓: 굵기(px)·불투명도(0.1~1)·부드러운 가장자리 */
  paintWidth?: number
  paintOpacity?: number
  paintSoft?: boolean
  /** 펜 종류(펜·도형일 때 쓴다) */
  brush?: Brush
  /** 도형 도구에서 고른 도형 */
  shape?: ShapeKind
  /** 닫힌 도형의 채움 불투명도(0이면 테두리만) */
  shapeFill?: number
  /** 스포이트: 다음 한 번의 지면 터치가 그 자리의 합성 색(종이+채색+잉크)을 집어 onPick으로 알린다 */
  picking?: boolean
  onPick?: (color: string) => void
  /** 노트 종이(모양·여백 선·색). 없으면 기본 줄 노트 */
  paper?: Paper
  /** 펜 전용 모드(penOnly.ts): 손가락은 그리지 않고 한 손가락으로도 스크롤한다 */
  fingerScrolls?: boolean
  /** 펜(스타일러스) 입력을 처음 봤을 때 */
  onPenSeen?: () => void
  /** 화면 고정: 손가락 스크롤·핀치와 휠 확대로 화면이 움직이지 않는다(확대·축소 버튼과 단축키는 그대로) */
  viewLocked?: boolean
  /** 여러 손가락으로 짧게 톡(2: 되돌리기, 3: 다시하기에 쓴다) */
  onFingerTap?: (fingers: number) => void
  /** 지우개 반지름(장 좌표). 주면 포인터 자리에 그 크기의 동그라미를 보인다(판타블렛처럼 커서가 없어도 지울 자리가 보이게) */
  eraserRadius?: number
  /** 곡선을 찍는 동안 찍은 점 수가 바뀔 때(0이면 곡선이 끝났다). 되돌리기 버튼을 켜고 끄는 데 쓴다 */
  onCurveChange?: (points: number) => void
  /** 곡선을 찍는 동안 바깥(되돌리기 키·버튼)에서 마지막 점을 지울 수 있게 채워 준다 */
  curveControl?: MutableRefObject<{ undoPoint: () => void } | null>
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
  /** 맞춤 배율을 폭뿐 아니라 높이에도 맞춘다(집중 모드: 종이 전체가 보이게) */
  fitHeight?: boolean
  /** Ctrl+휠·핀치로 배율을 바꾸고 싶을 때. anchor 아래의 종이 자리는 바뀐 뒤에도 그대로다. */
  onZoom?: (zoom: number, anchor: ClientPoint) => void
  /** 포인터를 누를 때마다 불린다(되돌리기 단위 나누기) */
  onGestureStart?: () => void
  /** 장 좌표계(1600×2400) 위에 올라가는 DOM 레이어(글 상자, 커서 등) */
  children?: ReactNode
  /** 종이 바로 위·채색과 잉크 아래에 깔리는 DOM 레이어(사진). 포인터는 받지 않는다 */
  underlay?: ReactNode
  /** 선택 표시 등 획 위에 겹쳐 그리는 오버레이 */
  overlay?: (ctx: CanvasRenderingContext2D) => void
  overlayVersion?: number
  /** 끄는 중인 획을 문서에 쓰기 전에 옮겨 보여 준다(놓을 때 한 번만 저장) */
  preview?: { ids: string[]; m: Matrix } | null
  /** 지우개를 올려 둔 자리에서 지워질 획 id. 흐리게 그리고 점선 상자로 감싼다(화면에만) */
  eraseTargets?: string[]
}

export function PageView({
  doc,
  tool,
  ink,
  widthLevel,
  customWidth = null,
  paintWidth = 48,
  paintOpacity: paintAlpha = DEFAULT_PAINT_OPACITY,
  paintSoft = false,
  brush,
  shape = DEFAULT_SHAPE,
  shapeFill = 0,
  picking = false,
  onPick,
  eraserRadius,
  paper = DEFAULT_PAPER,
  fingerScrolls = false,
  onPenSeen,
  viewLocked = false,
  onFingerTap,
  onCurveChange,
  curveControl,
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
  fitHeight = false,
  onZoom,
  children,
  underlay,
  overlay,
  overlayVersion,
  preview,
  eraseTargets,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const inkCanvasRef = useRef<HTMLCanvasElement>(null)
  // 채색 획은 잉크 아래 색 캔버스에 multiply로 겹친다(render.ts paintColorStrokes)
  const colorCanvasRef = useRef<HTMLCanvasElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(0.5)
  const drawing = useRef<Stroke | null>(null)
  // 손잡이 등에 올렸을 때의 커서(어느 도구가 정했는지와 함께)
  const [hover, setHover] = useState<{ tool?: PointerTool; cursor: string | null }>({ cursor: null })
  // 만년필: 앞 점의 위치·시각·필압(속도로 필압을 만들 때 쓴다)
  const lastSample = useRef<{ x: number; y: number; t: number; p: number } | null>(null)
  /** Shift 직선의 시작점(직선으로 바뀐 획만). 손을 떼면 비운다. */
  const straight = useRef<{ x: number; y: number; p: number } | null>(null)
  /** 도형 도구: 끌기 시작한 곳 */
  const shapeStart = useRef<Point | null>(null)
  /** n점 곡선: 찍은 점들과 마지막으로 찍은 점(두 번 눌러 끝내기 판정용) */
  const curve = useRef<{ controls: Point[]; last: { x: number; y: number; t: number } } | null>(null)
  // 찍은 점 수(완료·취소 막대를 보이고 숨기는 데만 쓴다)
  const [curveCount, setCurveCount] = useState(0)
  // 지우개 동그라미(포인터를 따라 자주 움직이므로 리액트 상태 대신 스타일을 바로 바꾼다)
  const ringRef = useRef<HTMLDivElement>(null)
  // 곡선: 마지막으로 올려 둔 다음 점 자리, 그 자리가 첫 점 닫기 자리인지
  const curveHover = useRef<Point | null>(null)
  const curveNearFirst = useRef(false)
  // 지금 처리 중인 포인터. 두 번째 손가락·손바닥이 한 획에 섞이지 않게 한다.
  const activePointer = useRef<number | null>(null)
  // 마지막 포인터 화면 위치. 누른 채 스크롤하면 이 위치로 장 좌표를 다시 계산한다.
  const lastClient = useRef<{ x: number; y: number } | null>(null)
  // 터치: 한 손가락은 그리기(도구 동작), 두 손가락은 스크롤·핀치
  const touchPan = useRef(new TouchPan())
  // 이번 방문에서 펜 입력을 봤는지(펜 전용 모드 '자동'의 근거)
  const penSeen = useRef(false)
  // 핀치: 두 손가락이 닿은 순간의 배율·종이 위치·스크롤. 끄는 동안은 종이에 transform으로만 미리 보이고(캔버스를 다시
  // 그리지 않는다), 손을 떼면 한 번에 배율을 확정한다. 매 프레임 배율을 바꾸면 다시 그리기와 스크롤 보정이 겹쳐 출렁였다.
  const pinch = useRef<{
    scale: number
    frameLeft: number
    frameTop: number
    scrollLeft: number
    scrollTop: number
    target: number | null
    anchor: ClientPoint | null
    raf: number
  } | null>(null)
  const dpr = canvasPixelRatio(PAGE_WIDTH * scale, PAGE_HEIGHT * scale, window.devicePixelRatio || 1)
  const pixelScale = scale * dpr

  // 배율을 바꾸기 전에 적어 두는 기준점. 없으면 상자 가운데. 바뀐 뒤 그 아래의 종이 자리로 스크롤을 맞춘다.
  const requested = useRef<{ zoom: number; anchor: ClientPoint } | null>(null)
  const restore = useRef<ZoomAnchor | null>(null)
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const lockedRef = useRef(viewLocked)
  lockedRef.current = viewLocked

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const s = zoom === 'fit' ? (fitHeight ? fitScaleIn(el.clientWidth, el.clientHeight) : fitScale(el.clientWidth)) : zoom
      const frame = frameRef.current
      if (frame && s !== scaleRef.current && !restore.current) {
        const req = requested.current
        requested.current = null
        const box = el.getBoundingClientRect()
        const point =
          req && req.zoom === zoom ? req.anchor : { clientX: box.left + el.clientWidth / 2, clientY: box.top + el.clientHeight / 2 }
        restore.current = anchorAt(point, frame.getBoundingClientRect(), scaleRef.current)
      }
      setScale(s)
      onScale?.(s)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onScale, zoom, fitHeight])

  useLayoutEffect(() => {
    const el = viewportRef.current
    const frame = frameRef.current
    const anchor = restore.current
    if (!el || !frame || !anchor) return
    restore.current = null
    frame.style.transform = ''
    frame.style.transformOrigin = ''
    const next = scrollAfterZoom(anchor, frame.getBoundingClientRect(), scale, { left: el.scrollLeft, top: el.scrollTop })
    el.scrollLeft = next.left
    el.scrollTop = next.top
  }, [scale])

  // 두 손가락 스크롤: 손가락 이벤트가 번갈아 오면 가운데 점이 ±소수점으로 흔들리는데, 스크롤 값이 정수로 반올림되며
  // 한쪽으로 조금씩 쌓였다. 소수점은 모아 두었다가 1px이 될 때 반영한다.
  const panCarry = useRef({ x: 0, y: 0 })
  const panBy = useCallback((dx: number, dy: number) => {
    const frame = frameRef.current
    if (!frame) return
    const c = panCarry.current
    c.x += dx
    c.y += dy
    const ix = Math.trunc(c.x)
    const iy = Math.trunc(c.y)
    c.x -= ix
    c.y -= iy
    if (ix || iy) scrollNearest(frame, ix, iy)
  }, [])

  /** 핀치 미리보기: 종이를 기준점(손가락 가운데)을 중심으로 transform으로 키워 보인다. 스크롤로 움직인 만큼은 빼고 계산한다. */
  const previewPinch = useCallback(() => {
    const pz = pinch.current
    const frame = frameRef.current
    const vp = viewportRef.current
    if (!pz || !frame || !vp) return
    pz.raf = 0
    const ratio = touchPan.current.pinchRatio()
    if (ratio !== null) {
      pz.target = pinchZoom(pz.scale, 1, ratio)
      const c = touchPan.current.centerPoint()
      pz.anchor = { clientX: c.x, clientY: c.y }
    }
    if (pz.target === null || !pz.anchor) return
    const left = pz.frameLeft - (vp.scrollLeft - pz.scrollLeft)
    const top = pz.frameTop - (vp.scrollTop - pz.scrollTop)
    const k = pz.target / pz.scale
    frame.style.transformOrigin = `${pz.anchor.clientX - left}px ${pz.anchor.clientY - top}px`
    frame.style.transform = `scale(${k})`
  }, [])

  /** 핀치 끝: 미리 보인 배율을 한 번에 확정한다. 기준점 아래의 종이 자리는 그대로다. */
  const commitPinch = useCallback(() => {
    const pz = pinch.current
    const frame = frameRef.current
    const vp = viewportRef.current
    pinch.current = null
    if (!pz || !frame || !vp) return
    if (pz.raf) cancelAnimationFrame(pz.raf)
    if (pz.target === null || !pz.anchor || !onZoom || Math.abs(pz.target - scaleRef.current) < 0.002) {
      frame.style.transform = ''
      frame.style.transformOrigin = ''
      return
    }
    const left = pz.frameLeft - (vp.scrollLeft - pz.scrollLeft)
    const top = pz.frameTop - (vp.scrollTop - pz.scrollTop)
    // transform이 걸린 채라 getBoundingClientRect를 쓸 수 없다. 스크롤을 뺀 원래 자리로 기준점의 종이 좌표를 적는다.
    restore.current = anchorAt(pz.anchor, { left, top }, scaleRef.current)
    requested.current = { zoom: pz.target, anchor: pz.anchor }
    onZoom(pz.target, pz.anchor)
  }, [onZoom])

  // Ctrl(⌘)+휠·트랙패드 핀치: 마우스 위치를 기준으로 연속 확대·축소. 브라우저 확대를 막아야 하므로 passive가 아니어야 한다.
  const wheelAcc = useRef<{ delta: number; point: ClientPoint; frame: number } | null>(null)
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !onZoom) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      if (lockedRef.current) return
      const acc = wheelAcc.current
      if (acc) {
        acc.delta += e.deltaY
        acc.point = { clientX: e.clientX, clientY: e.clientY }
        return
      }
      wheelAcc.current = {
        delta: e.deltaY,
        point: { clientX: e.clientX, clientY: e.clientY },
        frame: requestAnimationFrame(() => {
          const a = wheelAcc.current
          wheelAcc.current = null
          if (!a) return
          const next = wheelZoom(scaleRef.current, a.delta)
          if (Math.abs(next - scaleRef.current) < 0.0005) return
          requested.current = { zoom: next, anchor: a.point }
          onZoom(next, a.point)
        }),
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (wheelAcc.current) cancelAnimationFrame(wheelAcc.current.frame)
    }
  }, [onZoom])

  // 끌어 옮기기: Space를 누른 채 왼쪽 버튼, 또는 가운데 버튼. 글을 쓰는 중의 Space는 가로채지 않는다.
  const [spaceHeld, setSpaceHeld] = useState(false)
  const pan = useRef<{ id: number; x: number; y: number } | null>(null)
  useEffect(() => {
    if (readOnly && !onZoom) return
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
    const down = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || typing(e.target)) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false)
    }
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [readOnly, onZoom])

  // 잉크 캔버스에 무엇까지 그려져 있는지(inkCache.ts). null이면 덧그릴 수 없어 다음 변화 때 전체를 다시 그린다.
  const painted = useRef<Painted | null>(null)

  const repaint = useCallback(() => {
    painted.current = null
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
    // 지우개를 올려 둔 자리에서 지워질 획은 따로 흐리게 그리고 점선 상자로 감싼다
    const doomedIds = eraseTargets?.length ? new Set(eraseTargets) : null
    const kept = doomedIds ? strokes.filter((s) => !doomedIds.has(s.id)) : strokes
    // 색 캔버스: 채색 획 전부(숨긴 레이어 0, 레이어 불투명도·강조 흐림·지우개 미리보기만 반영)
    const color = colorCanvasRef.current?.getContext('2d')
    if (color) {
      color.setTransform(1, 0, 0, 1, 0, 0)
      color.clearRect(0, 0, color.canvas.width, color.canvas.height)
      paintColorStrokes(color, strokes, pixelScale, (s) => {
        const id = layerOf(s, layers)
        if (hiddenLayers?.has(id)) return 0
        let a = layers.find((l) => l.id === id)?.opacity ?? 1
        if (highlightLayer && id !== highlightLayer) a *= DIM
        if (doomedIds?.has(s.id)) a *= ERASE_PREVIEW_ALPHA
        return a
      })
    }
    const plan = layerPlan(kept, layers, hiddenLayers)
    paintLayers(ctx, highlightPlan(plan, highlightLayer), pixelScale)
    if (doomedIds) {
      const doomed = strokes.filter((s) => doomedIds.has(s.id))
      const faded = layerPlan(doomed, layers, hiddenLayers).map((item) => ({
        ...item,
        layer: { ...item.layer, opacity: item.layer.opacity * ERASE_PREVIEW_ALPHA },
      }))
      paintLayers(ctx, faded, pixelScale)
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
      paintEraseOutlines(ctx, doomed, scale, pixelScale, eraserRadius ?? 10)
    }
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
    // 획 위에 다른 것(미리보기·지우개 표시·강조·선택 상자)이 없을 때만 새 획을 덧그릴 수 있다
    painted.current = preview || doomedIds || highlightLayer || overlay ? null : paintedAfter(plan, layers)
  }, [doc, pixelScale, overlay, preview, hiddenLayers, highlightLayer, scale, eraseTargets, eraserRadius])

  // 문서가 바뀌면 다음 프레임에 한 번만 그린다. 획이 더해지기만 했으면 그 획만 덧그리고(1만 획이어도 1ms),
  // 지우거나 옮기거나 레이어가 바뀌면 전체를 다시 그린다.
  useEffect(() => {
    let frame = 0
    let added: string[] = []
    let dirty = true
    const run = () => {
      frame = 0
      const ids = added
      const full = dirty || painted.current === null || ids.length === 0
      added = []
      dirty = false
      if (full) {
        repaint()
        return
      }
      const map = strokesMap(doc)
      const strokes = ids.flatMap((id) => {
        const m = map.get(id)
        return m ? [readStroke(id, m)] : []
      })
      const layers = readLayers(doc)
      // 채색 획은 색 캔버스에 덧그리기만 하면 된다(multiply는 순서와 무관). painted가 있다는 건 미리보기·지우개
      // 표시·강조가 없다는 뜻이라 덧그린 결과가 전체 다시 그리기와 같다.
      const color = colorCanvasRef.current?.getContext('2d')
      const paints = strokes.filter((s) => s.tool === 'paint' || typeof s.fill === 'number')
      if (paints.length && !color) {
        repaint()
        return
      }
      if (color) {
        paintColorStrokes(color, paints, pixelScale, (s) => {
          const id = layerOf(s, layers)
          return hiddenLayers?.has(id) ? 0 : (layers.find((l) => l.id === id)?.opacity ?? 1)
        })
      }
      const pens = strokes.filter((s) => s.tool !== 'paint')
      if (pens.length === 0) return
      const plan = appendPlan(painted.current!, pens, layers, hiddenLayers)
      const ctx = inkCanvasRef.current?.getContext('2d')
      if (!plan || !ctx) {
        repaint()
        return
      }
      paintStrokes(ctx, plan.strokes, pixelScale)
      painted.current = plan.painted
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run)
    }
    schedule()
    const strokes = strokesMap(doc)
    const layers = layersMap(doc)
    const onStrokes = (events: Y.YEvent<Y.Map<unknown>>[]) => {
      for (const ev of events) {
        if (ev.target !== strokes) {
          dirty = true
          continue
        }
        for (const [id, change] of ev.changes.keys) {
          if (change.action === 'add') added.push(id)
          else dirty = true
        }
      }
      schedule()
    }
    const onLayers = () => {
      dirty = true
      schedule()
    }
    strokes.observeDeep(onStrokes)
    layers.observe(onLayers)
    return () => {
      strokes.unobserveDeep(onStrokes)
      layers.unobserve(onLayers)
      cancelAnimationFrame(frame)
    }
  }, [doc, repaint, overlayVersion, hiddenLayers, pixelScale])

  const paintLive = useCallback(() => {
    const canvas = liveCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const s = drawing.current
    if (!s) return
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
    // 닫힌 도형을 그리는 중이면 채움도 미리 보인다(라이브 캔버스는 보통 합성이라 대략의 모양)
    if (tool === 'shape' && shapeFill > 0 && closedShape(shape) && !curve.current) {
      ctx.globalAlpha = shapeFill * 0.9
      ctx.fillStyle = s.color
      ctx.fill(fillPath(s))
      ctx.globalAlpha = 1
    }
    if (s.tool === 'highlighter') ctx.globalAlpha = 0.45
    else if (s.tool === 'paint') {
      // 라이브 캔버스는 CSS multiply(data-blend)로 종이·잉크와 섞인다. 불투명도·번짐만 여기서.
      ctx.globalAlpha = paintOpacity(s)
      const r = softRadius(s)
      if (r) ctx.filter = `blur(${r * pixelScale}px)`
    }
    paintStroke(ctx, s)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    const c = curve.current
    if (c) paintCurveMarks(ctx, c.controls, curveNearFirst.current, scale)
  }, [pixelScale, scale, tool, shape, shapeFill])

  /** 지우개 동그라미를 장 좌표 p(없으면 숨김)에 둔다. 화면에서 너무 작아지지 않게 최소 크기를 둔다. */
  function placeRing(p: Point | null) {
    const el = ringRef.current
    if (!el) return
    if (!p || !eraserRadius) {
      el.style.display = 'none'
      return
    }
    const r = Math.max(eraserRadius * scale, 5)
    el.style.display = 'block'
    el.style.width = el.style.height = `${r * 2}px`
    el.style.transform = `translate(${p.x * scale - r}px, ${p.y * scale - r}px)`
  }

  /**
   * 지면 한 점의 합성 색: 종이 바탕 → 색 캔버스(multiply) → 잉크 캔버스(보통 합성). 화면에 보이는 색과 거의 같다.
   * 캔버스를 읽을 수 없으면(시험 환경) 종이 바탕색.
   */
  function sampleColor(p: Point): string {
    const ground = paperPalette(paper.color).ground
    const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
    const parse = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
    let rgb = parse(ground)
    const read = (canvas: HTMLCanvasElement | null) => {
      try {
        const d = canvas?.getContext('2d')?.getImageData(Math.floor(p.x * pixelScale), Math.floor(p.y * pixelScale), 1, 1).data
        return d && d.length >= 4 ? [d[0], d[1], d[2], d[3] / 255] : null
      } catch {
        return null
      }
    }
    const color = read(colorCanvasRef.current)
    if (color) rgb = rgb.map((v, i) => v * (1 - color[3]) + ((v * color[i]) / 255) * color[3])
    const ink = read(inkCanvasRef.current)
    if (ink) rgb = rgb.map((v, i) => v * (1 - ink[3]) + ink[i] * ink[3])
    return `#${rgb.map(hex).join('')}`
  }

  function pagePoint(e: PointerEvent<HTMLDivElement>): Point {
    const rect = frameRef.current!.getBoundingClientRect()
    return clampToPage(toPagePoint(e.clientX, e.clientY, rect, scale))
  }

  /** 점의 필압 값. 필압을 끄면 고정값, 만년필을 필압 없는 입력으로 쓰면 속도로 만든다. */
  function pressure(e: PressureSample, q: Point): number {
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

  /** 지금 레이어에 그릴 수 있는지. 못 그리면 이유를 알린다. */
  function canDrawHere(): boolean {
    if (layer && !canDrawOn(readLayers(doc), layer)) {
      onDrawBlocked?.('locked')
      return false
    }
    if (layer && hiddenLayers?.has(layer)) {
      // 숨긴 레이어에 그리면 손을 떼는 순간 내 화면에서 사라진다
      onDrawBlocked?.('hidden')
      return false
    }
    return true
  }

  /** 도형 획: 지금 펜 종류·색·굵기로, 필압과 상관없이 굵기가 일정하게 */
  function shapeStroke(): Stroke {
    return {
      id: newId(),
      tool: 'pen',
      color: ink,
      width: strokeWidth('pen', widthLevel, customWidth),
      points: [],
      author,
      createdAt: Date.now(),
      ...(brush ? { brush } : {}),
      steady: true,
      ...(layer ? { layer } : {}),
    }
  }

  /** p가 첫 점 닫기 자리에 있는지(점이 셋 이상일 때만 닫을 수 있다) */
  function nearFirst(c: { controls: Point[] }, p: Point | null): boolean {
    const first = c.controls[0]
    return !!p && c.controls.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) * scale <= CURVE_SNAP_PX
  }

  /**
   * 곡선 미리보기: 찍은 점들(+ 다음 점 자리)을 지나는 곡선. 다음 점이 첫 점 닫기 자리면 닫힌 모양을 보여 준다.
   * next를 기억해 두어 점을 되돌린 뒤에도 같은 자리로 다시 그린다.
   */
  function showCurve(next: Point | null) {
    const c = curve.current
    const s = drawing.current
    if (!c || !s) return
    curveHover.current = next
    curveNearFirst.current = nearFirst(c, next)
    s.points = curveNearFirst.current
      ? curvePoints(c.controls, true)
      : curvePoints(next ? [...c.controls, next] : c.controls, false)
    paintLive()
  }

  /** 곡선 점 찍기. 두 번 누르면 끝내고, 점이 셋 이상일 때 첫 점을 누르면 닫는다. */
  function curveDown(p: Point, t: number) {
    const c = curve.current
    if (!c) {
      curve.current = { controls: [p], last: { x: p.x, y: p.y, t } }
      drawing.current = shapeStroke()
      setCurveCount(1)
      onCurveChange?.(1)
      showCurve(null)
      return
    }
    const near = (q: Point) => Math.hypot(p.x - q.x, p.y - q.y) * scale <= CURVE_SNAP_PX
    if (nearFirst(c, p)) return finishCurve(true)
    if (t - c.last.t < DOUBLE_TAP_MS && near(c.last)) return finishCurve(false)
    c.controls.push(p)
    c.last = { x: p.x, y: p.y, t }
    setCurveCount(c.controls.length)
    onCurveChange?.(c.controls.length)
    showCurve(null)
  }

  /** 곡선 중 되돌리기: 마지막으로 찍은 점만 지운다. 점이 하나뿐이면 곡선을 버린다. */
  function undoCurvePoint() {
    const c = curve.current
    if (!c) return
    c.controls.pop()
    if (c.controls.length === 0) return cancelCurve()
    const last = c.controls[c.controls.length - 1]
    // 되돌린 바로 뒤 그 자리를 누른 것이 두 번 누르기로 잡히지 않게 한다
    c.last = { x: last.x, y: last.y, t: -Infinity }
    setCurveCount(c.controls.length)
    onCurveChange?.(c.controls.length)
    showCurve(curveHover.current)
  }

  /** 곡선을 저장한다(점이 둘 이상일 때). closed면 첫 점으로 닫는다. */
  function finishCurve(closed: boolean) {
    const c = curve.current
    const s = drawing.current
    curve.current = null
    drawing.current = null
    activePointer.current = null
    curveNearFirst.current = false
    setCurveCount(0)
    onCurveChange?.(0)
    if (c && s && c.controls.length >= 2)
      addStroke(doc, { ...s, points: curvePoints(c.controls, closed), ...(closed && shapeFill > 0 ? { fill: shapeFill } : {}) }, origin)
    paintLive()
  }

  function cancelCurve() {
    curve.current = null
    drawing.current = null
    activePointer.current = null
    curveNearFirst.current = false
    setCurveCount(0)
    onCurveChange?.(0)
    paintLive()
  }
  // 최신 함수를 효과·바깥(되돌리기 버튼)에서 부르기 위해 둔다
  const curveActions = useRef({ finishCurve, cancelCurve, undoCurvePoint })
  curveActions.current = { finishCurve, cancelCurve, undoCurvePoint }
  useEffect(() => {
    if (!curveControl) return
    curveControl.current = { undoPoint: () => curveActions.current.undoCurvePoint() }
    return () => {
      curveControl.current = null
    }
  }, [curveControl])

  // 곡선 중: Enter로 끝내고 Esc로 취소한다(글 상자 등에 쓰는 중이면 그대로 둔다)
  useEffect(() => {
    if (curveCount === 0) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'Enter') curveActions.current.finishCurve(false)
      else if (e.key === 'Escape') curveActions.current.cancelCurve()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [curveCount])

  // 도구·도형을 바꾸면 찍던 곡선은 그대로 마무리한다(점이 하나뿐이면 버린다)
  useEffect(() => () => {
    if (curve.current) curveActions.current.finishCurve(false)
  }, [tool, shape])

  // 끌던 중 Esc·되돌리기 단축키: 되돌리기나 집중 모드 나가기 대신 지금 하던 것(지우개·옮기기·긋던 획)을 거둔다.
  // 캡처 단계에서 잡아 전파를 끊으므로 NotePage의 되돌리기·Esc 처리는 끌던 중에는 돌지 않는다. 곡선은 제 처리(Enter·Esc)가 있다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activePointer.current === null || curve.current) return
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('input, textarea, [contenteditable="true"]')) return
      const undoKey = matches(getKeymap(), 'undo', e)
      if (e.key !== 'Escape' && !undoKey) return
      e.preventDefault()
      e.stopPropagation()
      gestureActions.current.cancelGesture()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /**
   * 하던 동작을 거둔다(두 번째 손가락이 닿았거나 Esc·Ctrl+Z). 막 시작한 획은 버리고, 거두기(cancel)를 아는 도구는
   * 그것으로, 모르는 도구는 그 자리에서 끝낸다(포인터 이벤트가 있을 때만).
   */
  function cancelGesture(e?: PointerEvent<HTMLDivElement>) {
    if (activePointer.current === null) return
    activePointer.current = null
    if (curve.current) {
      // 곡선: 이번에 찍은 점만 버리고 이어 찍을 수 있게 둔다
      undoCurvePoint()
      return
    }
    if (drawing.current) {
      drawing.current = null
      paintLive()
      return
    }
    if (pointerTool?.cancel) {
      pointerTool.cancel()
      return
    }
    const c = lastClient.current
    const frame = frameRef.current
    if (e && c && frame) pointerTool?.up?.(clampToPage(toPagePoint(c.x, c.y, frame.getBoundingClientRect(), scale)), e)
  }
  // 최신 함수를 키 효과에서 부르기 위해 둔다
  const gestureActions = useRef({ cancelGesture })
  gestureActions.current = { cancelGesture }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && isPanButton(e.button, spaceHeld)) {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    if (readOnly || e.button > 0) return
    if (e.pointerType === 'pen' && !penSeen.current) {
      penSeen.current = true
      onPenSeen?.()
    }
    if (e.pointerType === 'touch') {
      const pan = touchPan.current
      const vp = viewportRef.current
      const frame = frameRef.current
      if (pan.down(e.pointerId, e.clientX, e.clientY, fingerScrolls)) {
        cancelGesture(e)
        // 첫 손가락을 잡은 글 상자 등이 끌기를 거두게 한다(그 요소는 stopPropagation 없이 손가락을 우리에게도 알렸다)
        frame?.dispatchEvent(new Event(PAN_START_EVENT))
      }
      if (pan.active && vp && frame && !pinch.current && !viewLocked) {
        const r = frame.getBoundingClientRect()
        pinch.current = {
          scale: scaleRef.current,
          frameLeft: r.left,
          frameTop: r.top,
          scrollLeft: vp.scrollLeft,
          scrollTop: vp.scrollTop,
          target: null,
          anchor: null,
          raf: 0,
        }
      }
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
    if (picking) {
      // 스포이트: 그리지 않고 색만 집는다
      e.preventDefault()
      onPick?.(sampleColor(p))
      return
    }
    placeRing(p)
    onGestureStart?.()
    if (tool === 'shape') {
      if (!curve.current && !canDrawHere()) return
      e.currentTarget.setPointerCapture(e.pointerId)
      activePointer.current = e.pointerId
      e.preventDefault()
      if (shape === 'curve') {
        curveDown(p, e.timeStamp)
        return
      }
      shapeStart.current = p
      drawing.current = { ...shapeStroke(), points: densify([p]) }
      paintLive()
      return
    }
    if (inkTool(tool)) {
      if (!canDrawHere()) return
      e.currentTarget.setPointerCapture(e.pointerId)
      startInk(tool, p, e.pointerId, e)
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
    const dragging = pan.current
    if (dragging && e.pointerId === dragging.id) {
      const el = viewportRef.current
      if (el) {
        el.scrollLeft -= e.clientX - dragging.x
        el.scrollTop -= e.clientY - dragging.y
      }
      dragging.x = e.clientX
      dragging.y = e.clientY
      return
    }
    if (e.pointerType === 'touch') {
      const d = touchPan.current.move(e.pointerId, e.clientX, e.clientY)
      if (touchPan.current.active) {
        if (viewLocked) return
        if (d) panBy(-d.dx, -d.dy)
        // 거리 판정은 프레임마다 한 번(previewPinch에서, 두 손가락이 모두 갱신된 뒤)
        const pz = pinch.current
        if (d && onZoom && pz && !pz.raf) pz.raf = requestAnimationFrame(previewPinch)
        return
      }
    }
    if (activePointer.current !== null && e.pointerId !== activePointer.current) return
    lastClient.current = { x: e.clientX, y: e.clientY }
    const p = pagePoint(e)
    onPointerMove?.(p)
    placeRing(p)
    if (tool === 'shape') {
      const c = curve.current
      if (c) {
        // 누른 채 끌면 방금 찍은 점을 옮기고, 올려만 두면 다음 점 자리를 미리 보여 준다
        if (activePointer.current !== null) c.controls[c.controls.length - 1] = p
        showCurve(activePointer.current !== null ? null : p)
        return
      }
      const s = drawing.current
      const start = shapeStart.current
      if (s && start && shape !== 'curve') {
        s.points = shapePoints(shape, start, p, e.shiftKey)
        paintLive()
      }
      return
    }
    const s = drawing.current
    if (s) {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? []
      extendInk(s, p, e.shiftKey, events.length ? events : [e.nativeEvent])
      return
    }
    if (activePointer.current === null) updateHover(p)
    else pointerTool?.move?.(p, e)
  }

  /** 펜·형광펜·채색 획을 시작한다. id는 이 획을 맡은 포인터(펜슬 터치로 긋는 획은 STYLUS_POINTER). */
  function startInk(tool: InkTool, p: Point, id: number, sample: PressureSample) {
    activePointer.current = id
    lastSample.current = null
    straight.current = null
    drawing.current = {
      id: newId(),
      tool,
      color: ink,
      width: tool === 'paint' ? paintWidth : strokeWidth(tool, widthLevel, customWidth),
      points: [round(p.x), round(p.y), pressure(sample, p)],
      author,
      createdAt: Date.now(),
      ...(tool === 'pen' && brush ? { brush } : {}),
      ...(tool === 'pen' && !pressureOn ? { steady: true } : {}),
      ...(tool === 'paint' ? { opacity: paintAlpha, ...(paintSoft ? { soft: true } : {}) } : {}),
      ...(layer ? { layer } : {}),
    }
    paintLive()
  }

  /** 긋던 획에 점을 잇는다. p는 마지막 표본의 장 좌표. */
  function extendInk(s: Stroke, p: Point, shift: boolean, samples: (PressureSample & ClientPoint)[]) {
    // Shift를 누르면(그리는 도중이라도) 시작점에서 지금 위치까지 직선으로 바꾸고, 손을 뗄 때까지 직선으로 둔다.
    if (shift || straight.current) {
      straight.current ??= { x: s.points[0], y: s.points[1], p: s.points[2] }
      const start = straight.current
      s.points = straightPoints(start, p, start.p)
      paintLive()
      return
    }
    const rect = frameRef.current!.getBoundingClientRect()
    for (const ev of samples) {
      const q = clampToPage(toPagePoint(ev.clientX, ev.clientY, rect, scale))
      s.points.push(round(q.x), round(q.y), pressure(ev, q))
    }
    paintLive()
  }

  // 펜슬 터치로 획 긋기. iPadOS Safari는 펜슬로 빠르게 이어 그으면 다음 획의 pointerdown을 빠뜨린다(터치 이벤트는 온다).
  // 포인터 이벤트가 그 획을 아직 받지 않았을 때만 터치 이벤트로 긋는다. 터치가 먼저 잡으면 그 획의 포인터 이벤트는
  // activePointer가 달라 쉰다(어느 쪽이 먼저 와도 한 획은 한 길로만 그어진다).
  const stylusTouch = useRef<number | null>(null)
  function stylusPoint(t: Touch): Point {
    return clampToPage(toPagePoint(t.clientX, t.clientY, frameRef.current!.getBoundingClientRect(), scale))
  }
  function stylusSample(t: Touch, e: TouchEvent): PressureSample & ClientPoint {
    return { clientX: t.clientX, clientY: t.clientY, pressure: t.force, pointerType: 'pen', timeStamp: e.timeStamp }
  }
  function onStylusStart(e: TouchEvent) {
    if (readOnly || picking || !inkTool(tool) || activePointer.current !== null) return
    const t = Array.from(e.changedTouches ?? []).find((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')
    // 글 상자 같은 DOM 위에서 누른 건 그 요소가 처리한다
    if (!t || (e.target instanceof Element && e.target.closest('[data-page-ui]'))) return
    if (!canDrawHere()) return
    if (!penSeen.current) {
      penSeen.current = true
      onPenSeen?.()
    }
    lastClient.current = { x: t.clientX, y: t.clientY }
    const p = stylusPoint(t)
    placeRing(p)
    onGestureStart?.()
    stylusTouch.current = t.identifier
    startInk(tool, p, STYLUS_POINTER, stylusSample(t, e))
  }
  function onStylusMove(e: TouchEvent) {
    const t = Array.from(e.changedTouches ?? []).find((t) => t.identifier === stylusTouch.current)
    const s = drawing.current
    if (!t || !s || activePointer.current !== STYLUS_POINTER) return
    lastClient.current = { x: t.clientX, y: t.clientY }
    const p = stylusPoint(t)
    onPointerMove?.(p)
    placeRing(p)
    extendInk(s, p, e.shiftKey, [stylusSample(t, e)])
  }
  function onStylusEnd(e: TouchEvent) {
    if (!Array.from(e.changedTouches ?? []).some((t) => t.identifier === stylusTouch.current)) return
    stylusTouch.current = null
    // 그사이 두 번째 손가락 등으로 거뒀으면 남길 것이 없다
    if (activePointer.current !== STYLUS_POINTER) return
    activePointer.current = null
    const s = drawing.current
    drawing.current = null
    if (s) addStroke(doc, s, origin)
    paintLive()
  }
  // 최신 함수를 터치 리스너에서 부르기 위해 둔다
  const stylusActions = useRef({ onStylusStart, onStylusMove, onStylusEnd })
  stylusActions.current = { onStylusStart, onStylusMove, onStylusEnd }

  /** 올려 둔 위치의 커서를 도구에게 묻는다. 바뀔 때만 다시 그린다. */
  function updateHover(p: Point | null) {
    if (!pointerTool?.hover) return
    const cursor = pointerTool.hover(p)
    if (hover.tool !== pointerTool || hover.cursor !== cursor) setHover({ tool: pointerTool, cursor })
  }

  function onUp(e: PointerEvent<HTMLDivElement>) {
    if (pan.current?.id === e.pointerId) {
      pan.current = null
      return
    }
    if (e.pointerType === 'touch') {
      const fingers = touchPan.current.up(e.pointerId, undefined, e.type === 'pointercancel')
      if (pinch.current) commitPinch()
      if (fingers) onFingerTap?.(fingers)
    }
    if (e.pointerId !== activePointer.current) return
    activePointer.current = null
    if (tool === 'shape') {
      // 곡선은 점을 찍을 때마다 이어 가고, 끝낼 때 한 번에 저장한다
      if (curve.current) return
      const s = drawing.current
      const start = shapeStart.current
      drawing.current = null
      shapeStart.current = null
      // 거의 움직이지 않은 탭은 도형으로 남기지 않는다
      const p = pagePoint(e)
      if (s && start && Math.hypot(p.x - start.x, p.y - start.y) * scale >= 4)
        addStroke(doc, closedShape(shape) && shapeFill > 0 ? { ...s, fill: shapeFill } : s, origin)
      paintLive()
      return
    }
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
    (spaceHeld ? 'grab' : null) ??
    hoverCursor ??
    (readOnly ? 'default' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : eraserRadius ? 'none' : 'crosshair')

  // 지면에서 시작한 글자 선택·길게 누르기 메뉴를 막는다(글 상자 안은 그대로).
  // iPad 펜슬로 천천히 긋거나 잠깐 멈추면 Safari가 길게 누르기로 보고 '복사하기' 메뉴를 띄워 그리기를 가로챘다.
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const block = (e: Event) => {
      const target = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement
      // 글씨·선택 도구로 쓰는 글 상자(data-page-ui) 안의 편집기는 평소처럼 고르고 메뉴를 연다
      if (target?.closest('[data-page-ui]') && target.closest('[contenteditable="true"], [contenteditable=""], input, textarea'))
        return
      e.preventDefault()
    }
    // iOS Safari는 선택·돋보기·'복사하기'를 touchstart가 막혀야만 포기한다(포인터 이벤트를 막아도 소용없다).
    // 그리는 도구일 때만: 선택 도구는 손가락 스크롤(touch-action)을 써야 하고, 글씨 도구는 탭으로 상자를 만들어
    // 화면 키보드를 띄워야 한다. 글 상자 위는 글 편집을 위해 둔다.
    const blockTouch = (e: TouchEvent) => {
      if (readOnly || tool === 'select' || tool === 'text') return
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('[data-page-ui]')) return
      e.preventDefault()
    }
    el.addEventListener('selectstart', block)
    el.addEventListener('contextmenu', block)
    el.addEventListener('touchstart', blockTouch, { passive: false })
    return () => {
      el.removeEventListener('selectstart', block)
      el.removeEventListener('contextmenu', block)
      el.removeEventListener('touchstart', blockTouch)
    }
  }, [readOnly, tool])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const start = (e: TouchEvent) => stylusActions.current.onStylusStart(e)
    const move = (e: TouchEvent) => stylusActions.current.onStylusMove(e)
    const end = (e: TouchEvent) => stylusActions.current.onStylusEnd(e)
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [])

  return (
    <div ref={viewportRef} className="page-viewport" style={viewLocked ? { overflow: 'hidden' } : undefined}>
      <div
        ref={frameRef}
        className="page-frame"
        style={{ width, height, cursor, touchAction: readOnly || tool === 'select' ? 'pan-x pan-y' : 'none' }}
        data-picking={picking || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => {
          lastClient.current = null
          onPointerMove?.(null)
          placeRing(null)
          if (activePointer.current === null) updateHover(null)
        }}
      >
        <div
          className="page-layer paper"
          style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})`, ...paperStyle(paper) }}
        />
        {underlay && (
          <div className="page-layer photos" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}>
            {underlay}
          </div>
        )}
        <canvas
          ref={colorCanvasRef}
          className="color-canvas"
          width={Math.round(width * dpr)}
          height={Math.round(height * dpr)}
          style={{ width, height }}
          aria-hidden="true"
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
          className="live-canvas"
          data-blend={tool === 'paint' ? 'multiply' : undefined}
          width={Math.round(width * dpr)}
          height={Math.round(height * dpr)}
          style={{ width, height }}
          aria-hidden="true"
        />
        <div className="page-layer" style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}>
          {children}
        </div>
        {eraserRadius ? <div ref={ringRef} className="eraser-ring" aria-hidden="true" /> : null}
      </div>
      {curveCount > 0 && (
        <div className="curve-bar" role="toolbar" aria-label="곡선">
          <span>
            곡선 · 점 {curveCount}개
            <span className="curve-bar-hint"> · 두 번 누르면 끝 · 첫 점(고리)을 누르면 닫혀요 · Ctrl+Z로 점 지우기</span>
          </span>
          <button type="button" className="curve-bar-btn" onClick={() => cancelCurve()}>
            취소
          </button>
          {curveCount >= 3 && (
            <button type="button" className="curve-bar-btn" onClick={() => finishCurve(true)}>
              닫기
            </button>
          )}
          <button type="button" className="curve-bar-btn primary" disabled={curveCount < 2} onClick={() => finishCurve(false)}>
            완료
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 곡선을 찍는 동안의 표시(장 좌표로 그린다, 화면에서 일정한 크기): 찍은 점마다 작은 점,
 * 점이 셋 이상이면 첫 점에 닫기 고리. 닫을 수 있는 자리에 올라가면 고리를 채운다.
 */
function paintCurveMarks(ctx: CanvasRenderingContext2D, controls: Point[], nearFirst: boolean, scale: number) {
  const px = (v: number) => v / scale
  ctx.save()
  ctx.fillStyle = '#2A47B0'
  for (const q of controls.slice(1)) {
    ctx.beginPath()
    ctx.arc(q.x, q.y, px(3.5), 0, Math.PI * 2)
    ctx.fill()
  }
  const first = controls[0]
  if (first) {
    ctx.beginPath()
    if (controls.length >= 3) {
      ctx.arc(first.x, first.y, px(nearFirst ? 11 : 9), 0, Math.PI * 2)
      ctx.lineWidth = px(2)
      ctx.strokeStyle = '#2A47B0'
      ctx.fillStyle = nearFirst ? 'rgba(42, 71, 176, 0.35)' : 'rgba(255, 255, 255, 0.85)'
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.arc(first.x, first.y, px(3.5), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** 지우개 미리보기에서 지워질 획을 흐리게 그리는 불투명도 */
const ERASE_PREVIEW_ALPHA = 0.3
/** 화면에서 이보다 작은 획(점 등)은 테두리가 지우개 동그라미에 가려 점선 동그라미를 더한다(px) */
const ERASE_SMALL_PX = 20

/**
 * 지워질 획마다 획 모양을 따라 빨간 테두리(화면에서 2px, 획에서 3px 띄움).
 * 다른 획을 지우지 않게 따로 그린 캔버스에서 바깥 굵은 선을 긋고 안쪽을 도려낸 뒤 얹는다.
 * 점처럼 작은 획은 지우개 동그라미보다 큰 점선 동그라미를 더한다.
 */
function paintEraseOutlines(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  scale: number,
  pixelScale: number,
  eraserRadius: number,
) {
  const off = document.createElement('canvas')
  off.width = ctx.canvas.width
  off.height = ctx.canvas.height
  const o = off.getContext('2d')
  if (!o) return
  o.setTransform(pixelScale, 0, 0, pixelScale, 0, 0)
  o.lineCap = 'round'
  o.lineJoin = 'round'
  o.strokeStyle = ERASE_COLOR
  const trace = (s: Stroke) => {
    o.beginPath()
    for (let i = 0; i + 1 < s.points.length; i += 3) {
      if (i === 0) o.moveTo(s.points[i], s.points[i + 1])
      else o.lineTo(s.points[i], s.points[i + 1])
    }
    if (s.points.length <= 3) o.lineTo(s.points[0] + 0.01, s.points[1])
  }
  const gap = 3 / scale
  const ring = 2 / scale
  for (const s of strokes) {
    trace(s)
    o.lineWidth = s.width + (gap + ring) * 2
    o.stroke()
  }
  o.globalCompositeOperation = 'destination-out'
  for (const s of strokes) {
    trace(s)
    o.lineWidth = s.width + gap * 2
    o.stroke()
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(off, 0, 0)
  ctx.restore()

  const small = strokes.map(strokeBounds).filter((b) => Math.max(b.width, b.height) * scale < ERASE_SMALL_PX)
  if (small.length === 0) return
  ctx.save()
  ctx.strokeStyle = ERASE_COLOR
  ctx.lineWidth = 1.5 / scale
  ctx.setLineDash([5 / scale, 4 / scale])
  for (const b of small) {
    const r = Math.max(Math.max(b.width, b.height) / 2, eraserRadius) + 7 / scale
    ctx.beginPath()
    ctx.arc(b.x + b.width / 2, b.y + b.height / 2, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

const ERASE_COLOR = '#C2410C'

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
