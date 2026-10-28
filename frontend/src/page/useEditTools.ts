import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import {
  deleteSelection,
  deleteStrokes,
  readStroke,
  readStrokes,
  readTextBox,
  strokesMap,
  textBoxText,
  textboxesMap,
  transformSelection,
  transformStrokes,
  type Stroke,
} from './doc'
import { LINE_GAP, PAGE_HEIGHT, snapToLine, type Point } from './geometry'
import { editableStrokes, erasableStrokes, grabIds, readLayers } from './layers'
import {
  normalizeRect,
  pathBounds,
  rectInLasso,
  rectsOverlap,
  strokeBounds,
  strokesHitBy,
  strokesInLasso,
  strokesInRect,
  topStrokeAt,
  unionRect,
  type Rect,
} from './hit'
import { useStrokeIndex } from './strokeIndex'
import type { PointerTool } from './PageView'
import type { ToolKind } from './tools'
import {
  anchorOf,
  cursorForHandle,
  andThen,
  boundsOfPoints,
  handleAt,
  handlePoints,
  IDENTITY,
  keepInPage,
  rotateAbout,
  rotationAngle,
  scaleAbout,
  scaleFactor,
  transformedCorners,
  translate,
  type Handle,
  type Matrix,
} from './transform'

/** 지우개 반지름(장 좌표). 화면의 지우개 동그라미도 이 크기로 그린다. */
export const ERASER_RADIUS = 10
const PICK_TOLERANCE = 8
/** 선택 상자 여백·손잡이 크기(화면 px). 장 좌표로는 배율로 나눈다. */
const BOX_PAD = 6
const HANDLE_HIT = 14
const HANDLE_SIZE = 10
const ROTATE_OFFSET = 30

/** 고른 것: 획과 글 상자. 섞어 고를 수 있다. */
export type Selection = { strokes: string[]; texts: string[] }
const NOTHING: Selection = { strokes: [], texts: [] }

export function hasSelection(s: Selection): boolean {
  return s.strokes.length > 0 || s.texts.length > 0
}

const plus = (a: Selection, b: Selection): Selection => ({
  strokes: [...a.strokes, ...b.strokes.filter((id) => !a.strokes.includes(id))],
  texts: [...a.texts, ...b.texts.filter((id) => !a.texts.includes(id))],
})
const minus = (a: Selection, b: Selection): Selection => ({
  strokes: a.strokes.filter((id) => !b.strokes.includes(id)),
  texts: a.texts.filter((id) => !b.texts.includes(id)),
})

/** 글 상자의 화면 높이(장 좌표). 높이는 저장하지 않으므로 그려진 상자에서 잰다. */
function domTextHeight(id: string): number | undefined {
  const el = document.querySelector<HTMLElement>(`.textbox[data-box-id="${id}"]`)
  return el?.offsetHeight || undefined
}

/**
 * 글 상자가 섞인 묶음은 줄 간격 단위로 옮긴다(글 상자가 줄 위에 남게). lineY는 묶음 속 글 상자 하나의 y.
 * 줄에 맞춰 장 밖으로 나가면 한 줄 안쪽으로 둔다.
 */
function snapToLines(m: Matrix, lineY: number, bounds: Rect): Matrix {
  let dy = snapToLine(lineY + m[5]) - lineY
  if (bounds.y + dy < 0) dy += LINE_GAP
  else if (bounds.y + bounds.height + dy > PAGE_HEIGHT) dy -= LINE_GAP
  return translate(m[4], dy)
}

type Drag =
  | {
      kind: 'move'
      sel: Selection
      start: Point
      bounds: Rect
      m: Matrix
      lineY: number | null
      /** 더해 고르기로 이미 고른 것을 눌렀을 때: 끌지 않고 떼면 이것을 고른 것에서 뺀다 */
      dropOnClick: Selection | null
    }
  | { kind: 'scale'; ids: string[]; bounds: Rect; anchor: Point; corner: Point; m: Matrix }
  | { kind: 'rotate'; ids: string[]; bounds: Rect; center: Point; start: Point; m: Matrix }
  | { kind: 'band'; start: Point; end: Point; add: boolean }
  | { kind: 'lasso'; path: Point[]; add: boolean }
  | { kind: 'erase'; last: Point; ids: Set<string> }

/** 끄는 모서리가 어느 손잡이인지 */
function cornerOf(r: Rect, p: Point): Handle {
  const left = p.x <= r.x + r.width / 2
  const top = p.y <= r.y + r.height / 2
  return top ? (left ? 'nw' : 'ne') : left ? 'sw' : 'se'
}

/** 변환한 묶음이 페이지 밖으로 나가면 안으로 밀어 넣는다 */
function fitted(bounds: Rect, m: Matrix): Matrix {
  const { dx, dy } = keepInPage(boundsOfPoints(transformedCorners(bounds, m)))
  return dx || dy ? andThen(m, translate(dx, dy)) : m
}

/** ids: 옮기는 획, texts: 옮기는 글 상자(이때 m은 이동뿐이다) */
type Move = { ids: string[]; texts: string[]; m: Matrix }

/**
 * 끄는 동안의 미리보기: 옮기는 획과 변환, 지우개로 지워질 획, 선택 상자를 다시 그릴 차례(version).
 * 포인터가 움직일 때마다 바뀌므로 리액트 상태로 두지 않는다(그러면 노트 화면 전체가 매번 다시 렌더된다).
 * PageView가 구독해 다음 프레임에 그 자리만 다시 그린다.
 */
export class EditPreview {
  move: Move | null = null
  eraseTargets: string[] = []
  version = 0
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  setMove(move: Move | null): void {
    if (move === this.move) return
    this.move = move
    this.bump()
  }

  setEraseTargets(ids: string[]): void {
    const prev = this.eraseTargets
    if (prev.length === ids.length && prev.every((id, k) => id === ids[k])) return
    this.eraseTargets = ids
    this.bump()
  }

  /** 선택 상자·손잡이 등 겹쳐 그리는 것이 바뀌었다 */
  bump(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }
}

/**
 * 지우개와 선택·이동 도구. 그리기·글씨는 다른 곳에서 처리한다.
 * 잠긴 레이어와 내가 숨긴 레이어의 획은 지우거나 고를 수 없고, 지우개는 지금 그리는 레이어의 획만 지운다.
 * 고른 묶음은 끌어서 옮기고, 모서리 손잡이로 키우거나 줄이고, 위쪽 손잡이로 돌린다(놓을 때 한 번 저장).
 * onlyAuthor를 주면 선택·이동은 그 사람(나)이 그린 획만 다룬다. 남의 획은 눌러도 고르지 않고 상자로 둘러도 빠진다.
 * lasso면 빈 곳에서 끌 때 상자 대신 지나간 길(올가미)로 둘러 고른다.
 * 글 상자도 함께 고른다(획과 섞어서). shift를 누르거나 additive(터치의 '더해 고르기')면 누르기는 더하기·빼기,
 * 상자·올가미는 고른 것에 더하기다. 글 상자가 섞인 묶음은 옮기기만 한다(크기·회전 손잡이를 숨긴다).
 */
export function useEditTools(
  doc: Y.Doc,
  tool: ToolKind,
  origin: unknown,
  hiddenLayers?: ReadonlySet<string>,
  scale = 1,
  /** 지금 그리는 레이어. 지우개는 이 레이어의 획만 지운다(없으면 잠기지 않은 모든 레이어) */
  currentLayer?: string,
  /** 지우개 반지름(장 좌표 px) */
  eraserRadius = ERASER_RADIUS,
  /** 있으면 선택·이동은 이 닉네임이 그린 획만 고른다('내가 그린 획만 고르기') */
  onlyAuthor?: string | null,
  /** 빈 곳에서 끌면 상자 대신 올가미로 고른다 */
  lasso = false,
  options: {
    /** 더해 고르기(터치에서 shift 대신 켜 두는 토글) */
    additive?: boolean
    /** 글 상자 높이 재기(시험용으로 바꿔 끼운다). 없으면 그려진 상자에서 잰다 */
    textHeight?: (id: string) => number | undefined
  } = {},
) {
  const { additive = false, textHeight = domTextHeight } = options
  const [selected, setSelected] = useState<Selection>(NOTHING)
  // 끄는 동안 자주 바뀌는 미리보기(옮기기 변환·지워질 획·선택 상자). 리액트 상태가 아니라 PageView가 구독한다.
  const live = useMemo(() => new EditPreview(), [])
  const drag = useRef<Drag | null>(null)
  // 마우스를 올려 둔 손잡이(강조해 그린다)
  const hovered = useRef<Handle | null>(null)
  const bump = useCallback(() => live.bump(), [live])
  const setPreview = useCallback((move: Move | null) => live.setMove(move), [live])
  // 지우개를 올려 둔 자리에서 누르면 지워질 획(화면에 흐리게 + 점선 상자로 보인다)
  const showEraseTargets = useCallback((ids: string[]) => live.setEraseTargets(ids), [live])

  // 도구를 바꾸면 선택과 지우개 표시를 푼다.
  useEffect(() => {
    if (tool !== 'select') setSelected((s) => (hasSelection(s) ? NOTHING : s))
    if (tool !== 'eraser') live.setEraseTargets([])
  }, [tool, live])

  // 다른 사람이 고른 획·글 상자를 지우면 선택에서도 뺀다.
  const any = hasSelection(selected)
  useEffect(() => {
    if (!any) return
    const strokes = strokesMap(doc)
    const texts = textboxesMap(doc)
    const prune = () =>
      setSelected((s) => {
        const next = { strokes: s.strokes.filter((id) => strokes.has(id)), texts: s.texts.filter((id) => texts.has(id)) }
        return next.strokes.length === s.strokes.length && next.texts.length === s.texts.length ? s : next
      })
    strokes.observe(prune)
    texts.observe(prune)
    return () => {
      strokes.unobserve(prune)
      texts.unobserve(prune)
    }
  }, [doc, any])

  /** 글 상자가 차지하는 자리(장 좌표) */
  const textRect = useCallback(
    (id: string): Rect | null => {
      const m = textboxesMap(doc).get(id)
      if (!m) return null
      const b = readTextBox(id, m)
      return { x: b.x, y: b.y, width: b.width, height: textHeight(id) ?? LINE_GAP }
    },
    [doc, textHeight],
  )

  /** 고른 획·글 상자를 감싸는 상자(여백 포함) */
  const selectionBox = useCallback(
    (sel: Selection): Rect | null => {
      // 고른 획만 읽는다(1만 획 노트에서 손잡이를 그릴 때마다 전부 읽지 않게)
      const map = strokesMap(doc)
      const r = unionRect([
        ...sel.strokes.flatMap((id) => {
          const m = map.get(id)
          return m ? [strokeBounds(readStroke(id, m))] : []
        }),
        ...sel.texts.flatMap((id) => textRect(id) ?? []),
      ])
      const pad = BOX_PAD / scale
      return r && { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
    },
    [doc, scale, textRect],
  )

  // 획 공간 색인: 지우개·선택 판정은 포인터 근처의 획만 본다(획 수에 비례해 느려지지 않게)
  const strokeIndex = useStrokeIndex(doc)

  const pointerTool = useMemo<PointerTool | undefined>(() => {
    const editable = () => editableStrokes(readStrokes(doc), readLayers(doc), hiddenLayers)
    const near = (rect: Rect): Stroke[] => {
      const map = strokesMap(doc)
      return strokeIndex()
        .near(rect)
        .flatMap((id) => {
          const m = map.get(id)
          return m ? [readStroke(id, m)] : []
        })
    }
    const editableNear = (rect: Rect) => editableStrokes(near(rect), readLayers(doc), hiddenLayers)
    const erasableNear = (rect: Rect) =>
      currentLayer ? erasableStrokes(near(rect), readLayers(doc), currentLayer, hiddenLayers) : editableNear(rect)
    // 선택·이동이 고를 수 있는 획: '내가 그린 획만 고르기'가 켜져 있으면 남의 획은 뺀다
    const mine = (strokes: Stroke[]) => (onlyAuthor ? strokes.filter((s) => s.author === onlyAuthor) : strokes)
    const pickable = () => mine(editable())
    const pickableNear = (rect: Rect) => mine(editableNear(rect))
    if (tool === 'eraser') {
      return {
        // 올려 두면 누를 때 지워질 획을 미리 알린다(화면에만 표시, 문서는 그대로)
        hover(p) {
          showEraseTargets(p ? strokesHitBy(erasableNear(pathBounds([p], eraserRadius)), [p], eraserRadius) : [])
          return null
        },
        // 끄는 동안은 지나간 획을 흐리게만 보이고, 손을 뗄 때 한 번에 지운다. 손가락으로 두 손가락 스크롤·핀치를
        // 시작할 때 첫 손가락이 닿은 자리의 획이 지워지지 않도록(그때는 cancel이 와서 아무것도 지우지 않는다).
        down(p) {
          const ids = new Set(strokesHitBy(erasableNear(pathBounds([p], eraserRadius)), [p], eraserRadius))
          drag.current = { kind: 'erase', last: p, ids }
          showEraseTargets([...ids])
          return true
        },
        move(p) {
          const d = drag.current
          if (d?.kind !== 'erase') return
          const before = d.ids.size
          const path = [d.last, p]
          for (const id of strokesHitBy(erasableNear(pathBounds(path, eraserRadius)), path, eraserRadius)) d.ids.add(id)
          d.last = p
          if (d.ids.size !== before) showEraseTargets([...d.ids])
        },
        up() {
          const d = drag.current
          drag.current = null
          if (d?.kind !== 'erase') return
          deleteStrokes(doc, [...d.ids], origin)
          showEraseTargets([])
        },
        cancel() {
          drag.current = null
          showEraseTargets([])
        },
      }
    }
    if (tool === 'select') {
      // 고를 수 있는 글 상자의 자리(위에 그려진 것이 뒤에 온다). 빈 상자(보이지 않는다)와 '내 것만'이면 남의 상자는 뺀다.
      const pickableTexts = (): (Rect & { id: string })[] =>
        Array.from(textboxesMap(doc).entries()).flatMap(([id, m]) => {
          if (onlyAuthor && m.get('author') !== onlyAuthor) return []
          if (!textBoxText(doc, id).trim()) return []
          const r = textRect(id)
          return r ? [{ ...r, id }] : []
        })
      const textAt = (p: Point) =>
        pickableTexts()
          .reverse()
          .find((r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) ?? null
      const inside = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
      // 글 상자가 섞이면 크기·회전 손잡이는 없다
      const handleOf = (box: Rect | null, p: Point) =>
        box && selected.texts.length === 0 ? handleAt(box, p, HANDLE_HIT / scale, ROTATE_OFFSET / scale) : null
      const startMove = (sel: Selection, p: Point, dropOnClick: Selection | null = null) => {
        const bounds = selectionBox(sel) ?? { x: p.x, y: p.y, width: 0, height: 0 }
        const first = sel.texts.length ? textboxesMap(doc).get(sel.texts[0]) : undefined
        const lineY = first ? (first.get('y') as number) : null
        drag.current = { kind: 'move', sel, start: p, bounds, m: IDENTITY, lineY, dropOnClick }
      }
      return {
        hover(p) {
          // 손잡이에 올리면 크기·회전 커서, 고른 묶음이나 획·글 상자 위면 옮기기 커서
          const box = p && hasSelection(selected) ? selectionBox(selected) : null
          const h = p ? handleOf(box, p) : null
          if (hovered.current !== h) {
            hovered.current = h
            bump()
          }
          if (!p) return null
          if (h) return cursorForHandle(h)
          if ((box && inside(box, p)) || textAt(p) || topStrokeAt(pickableNear(pathBounds([p], PICK_TOLERANCE)), p, PICK_TOLERANCE)) return 'move'
          return null
        },
        down(p, e) {
          // shift나 '더해 고르기'면 누르기는 더하기·빼기, 상자·올가미는 더하기
          const add = additive || !!e?.shiftKey
          const box = hasSelection(selected) ? selectionBox(selected) : null
          // 고른 묶음의 손잡이: 모서리는 크기, 위쪽 원은 회전
          const h = add ? null : handleOf(box, p)
          if (box && h === 'rotate') {
            const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            drag.current = { kind: 'rotate', ids: selected.strokes, bounds: box, center, start: p, m: IDENTITY }
            return true
          }
          if (box && h && h !== 'rotate') {
            drag.current = { kind: 'scale', ids: selected.strokes, bounds: box, anchor: anchorOf(box, h), corner: handlePoints(box, 0)[h], m: IDENTITY }
            return true
          }
          // 글 상자는 획 위에 있으므로 먼저 본다
          const text = textAt(p)
          const stroke = text ? null : topStrokeAt(pickableNear(pathBounds([p], PICK_TOLERANCE)), p, PICK_TOLERANCE)
          if (text || stroke) {
            // 기본 레이어가 아닌 레이어는 스티커처럼 통째로 잡는다
            const item: Selection = text
              ? { strokes: [], texts: [text.id] }
              : { strokes: grabIds([stroke!.id], pickable(), readLayers(doc)), texts: [] }
            const picked = text ? selected.texts.includes(text.id) : selected.strokes.includes(stroke!.id)
            // 더해 고르기로 이미 고른 것을 누르면: 떼면 빼고, 끌면 묶음째 옮긴다(터치에서 토글을 끄지 않고 옮기게)
            if (add && picked) {
              startMove(selected, p, item)
              return true
            }
            const next = picked ? selected : add ? plus(selected, item) : item
            setSelected(next)
            startMove(next, p)
            return true
          }
          // 고른 묶음 상자 안의 빈 곳: 묶음을 옮긴다
          if (!add && box && inside(box, p)) {
            startMove(selected, p)
            return true
          }
          if (!add) setSelected(NOTHING)
          drag.current = lasso ? { kind: 'lasso', path: [p], add } : { kind: 'band', start: p, end: p, add }
          return true
        },
        move(p) {
          const d = drag.current
          if (!d) return
          if (d.kind === 'band') {
            d.end = p
            bump()
            return
          }
          if (d.kind === 'lasso') {
            d.path.push(p)
            bump()
            return
          }
          if (d.kind === 'erase') return
          if (d.kind === 'move') {
            const m = fitted(d.bounds, translate(p.x - d.start.x, p.y - d.start.y))
            d.m = d.lineY === null ? m : snapToLines(m, d.lineY, d.bounds)
            setPreview({ ids: d.sel.strokes, texts: d.sel.texts, m: d.m })
            return
          }
          if (d.kind === 'scale') d.m = fitted(d.bounds, scaleAbout(d.anchor.x, d.anchor.y, scaleFactor(d.anchor, d.corner, p)))
          else d.m = fitted(d.bounds, rotateAbout(d.center.x, d.center.y, rotationAngle(d.center, d.start, p)))
          setPreview({ ids: d.ids, texts: [], m: d.m })
        },
        up() {
          const d = drag.current
          drag.current = null
          const moved = (m: Matrix) => m.some((v, i) => v !== IDENTITY[i])
          if (d?.kind === 'move') {
            // 획과 글 상자를 한 transaction으로(되돌리기 한 단계)
            if (moved(d.m)) transformSelection(doc, d.sel.strokes, d.sel.texts, d.m, origin)
            else if (d.dropOnClick) {
              setSelected(minus(selected, d.dropOnClick))
              bump()
            }
            setPreview(null)
          }
          if (d?.kind === 'scale' || d?.kind === 'rotate') {
            if (moved(d.m)) transformStrokes(doc, d.ids, d.m, origin)
            setPreview(null)
          }
          if (d?.kind === 'band') {
            const rect = normalizeRect(d.start, d.end)
            const found: Selection = {
              strokes: grabIds(strokesInRect(pickableNear(rect), rect), pickable(), readLayers(doc)),
              texts: pickableTexts()
                .filter((r) => rectsOverlap(r, rect))
                .map((r) => r.id),
            }
            setSelected(d.add ? plus(selected, found) : found)
            bump()
          }
          if (d?.kind === 'lasso') {
            const ids = d.path.length >= 3 ? strokesInLasso(pickableNear(pathBounds(d.path, 0)), d.path) : []
            const found: Selection = {
              strokes: grabIds(ids, pickable(), readLayers(doc)),
              texts: pickableTexts()
                .filter((r) => rectInLasso(r, d.path))
                .map((r) => r.id),
            }
            setSelected(d.add ? plus(selected, found) : found)
            bump()
          }
        },
        // 끌던 것을 결과 없이 거둔다: 옮기던 묶음은 원래 자리로, 그리던 선택 상자·올가미는 사라진다
        cancel() {
          drag.current = null
          setPreview(null)
          bump()
        },
      }
    }
    return undefined
  }, [tool, doc, origin, selected, bump, setPreview, hiddenLayers, scale, selectionBox, currentLayer, eraserRadius, showEraseTargets, strokeIndex, onlyAuthor, lasso, additive, textRect])

  const deleteSelected = useCallback(() => {
    deleteSelection(doc, selected.strokes, selected.texts, origin)
    setSelected(NOTHING)
  }, [doc, selected, origin])

  const overlay = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const d = drag.current
      ctx.save()
      ctx.lineWidth = 1.5 / scale
      ctx.strokeStyle = '#2A47B0'
      ctx.fillStyle = 'rgba(42, 71, 176, 0.06)'
      if (d?.kind === 'band') {
        const r = normalizeRect(d.start, d.end)
        ctx.setLineDash([8 / scale, 6 / scale])
        ctx.fillRect(r.x, r.y, r.width, r.height)
        ctx.strokeRect(r.x, r.y, r.width, r.height)
        ctx.restore()
        return
      }
      if (d?.kind === 'lasso') {
        // 지나간 길을 점선으로, 처음 점까지 닫아 안을 옅게 칠한다
        ctx.setLineDash([8 / scale, 6 / scale])
        ctx.beginPath()
        d.path.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()
        return
      }
      const box = hasSelection(selected) ? selectionBox(selected) : null
      if (!box) {
        ctx.restore()
        return
      }
      const m = live.move?.m ?? IDENTITY
      const corners = transformedCorners(box, m)
      // 선택 상자(돌리면 함께 기운다)
      ctx.setLineDash([8 / scale, 6 / scale])
      ctx.beginPath()
      corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      // 글 상자가 섞인 묶음은 옮기기만 한다(손잡이 없음)
      if (selected.texts.length) {
        ctx.restore()
        return
      }
      // 손잡이: 네 모서리(크기), 위쪽 원(회전)
      ctx.setLineDash([])
      const hs = HANDLE_SIZE / scale
      const [tlx, tly] = corners[0]
      const [trx, try_] = corners[1]
      const topMid = [(tlx + trx) / 2, (tly + try_) / 2]
      // 위쪽 가운데에서 상자 바깥 방향으로 ROTATE_OFFSET만큼
      const [cx, cy] = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2]
      const len = Math.hypot(topMid[0] - cx, topMid[1] - cy) || 1
      const off = ROTATE_OFFSET / scale
      const rot = [topMid[0] + ((topMid[0] - cx) / len) * off, topMid[1] + ((topMid[1] - cy) / len) * off]
      ctx.beginPath()
      ctx.moveTo(topMid[0], topMid[1])
      ctx.lineTo(rot[0], rot[1])
      ctx.stroke()
      // 올려 두었거나 끄는 중인 손잡이는 파랗게 채우고 조금 크게
      const active: Handle | null =
        d?.kind === 'rotate' ? 'rotate' : d?.kind === 'scale' ? cornerOf(d.bounds, d.corner) : hovered.current
      const names: Handle[] = ['nw', 'ne', 'se', 'sw']
      corners.forEach(([x, y], i) => {
        const on = active === names[i]
        const size = on ? hs * 1.4 : hs
        ctx.fillStyle = on ? '#2A47B0' : '#FFFFFF'
        ctx.fillRect(x - size / 2, y - size / 2, size, size)
        ctx.strokeRect(x - size / 2, y - size / 2, size, size)
      })
      ctx.beginPath()
      ctx.arc(rot[0], rot[1], (active === 'rotate' ? hs * 0.75 : hs / 2) + 1 / scale, 0, Math.PI * 2)
      ctx.fillStyle = active === 'rotate' ? '#2A47B0' : '#FFFFFF'
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    },
    [selected, live, scale, selectionBox],
  )

  return { pointerTool, overlay, selected, deleteSelected, live }
}
