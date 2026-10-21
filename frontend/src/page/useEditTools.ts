import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { deleteStrokes, readStrokes, transformStrokes } from './doc'
import type { Point } from './geometry'
import { editableStrokes, erasableStrokes, grabIds, readLayers } from './layers'
import { normalizeRect, strokeBounds, strokesHitBy, strokesInRect, topStrokeAt, unionRect, type Rect } from './hit'
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

type Drag =
  | { kind: 'move'; ids: string[]; start: Point; bounds: Rect; m: Matrix }
  | { kind: 'scale'; ids: string[]; bounds: Rect; anchor: Point; corner: Point; m: Matrix }
  | { kind: 'rotate'; ids: string[]; bounds: Rect; center: Point; start: Point; m: Matrix }
  | { kind: 'band'; start: Point; end: Point }
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

/**
 * 지우개와 선택·이동 도구. 그리기·글씨는 다른 곳에서 처리한다.
 * 잠긴 레이어와 내가 숨긴 레이어의 획은 지우거나 고를 수 없고, 지우개는 지금 그리는 레이어의 획만 지운다.
 * 고른 묶음은 끌어서 옮기고, 모서리 손잡이로 키우거나 줄이고, 위쪽 손잡이로 돌린다(놓을 때 한 번 저장).
 */
export function useEditTools(
  doc: Y.Doc,
  tool: ToolKind,
  origin: unknown,
  hiddenLayers?: ReadonlySet<string>,
  scale = 1,
  /** 지금 그리는 레이어. 지우개는 이 레이어의 획만 지운다(없으면 잠기지 않은 모든 레이어) */
  currentLayer?: string,
) {
  const [selected, setSelected] = useState<string[]>([])
  const [version, setVersion] = useState(0)
  // 끄는 동안에는 문서에 쓰지 않고 화면에서만 바꿔 보인다. 놓을 때 한 번만 저장한다.
  const [preview, setPreview] = useState<{ ids: string[]; m: Matrix } | null>(null)
  const drag = useRef<Drag | null>(null)
  // 마우스를 올려 둔 손잡이(강조해 그린다)
  const hovered = useRef<Handle | null>(null)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  // 지우개를 올려 둔 자리에서 누르면 지워질 획(화면에 흐리게 + 점선 상자로 보인다)
  const [eraseTargets, setEraseTargets] = useState<string[]>([])
  const showEraseTargets = useCallback(
    (ids: string[]) =>
      setEraseTargets((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids)),
    [],
  )

  // 도구를 바꾸면 선택과 지우개 표시를 푼다.
  useEffect(() => {
    if (tool !== 'select') setSelected([])
    if (tool !== 'eraser') setEraseTargets([])
  }, [tool])

  // 다른 사람이 선택한 획을 지우면 선택에서도 뺀다.
  useEffect(() => {
    if (selected.length === 0) return
    const strokes = doc.getMap('strokes')
    const prune = () => setSelected((ids) => ids.filter((id) => strokes.has(id)))
    strokes.observe(prune)
    return () => strokes.unobserve(prune)
  }, [doc, selected.length])

  /** 고른 획들을 감싸는 상자(여백 포함) */
  const selectionBox = useCallback(
    (ids: string[]): Rect | null => {
      const byId = new Map(readStrokes(doc).map((s) => [s.id, s]))
      const r = unionRect(ids.flatMap((id) => (byId.has(id) ? [strokeBounds(byId.get(id)!)] : [])))
      const pad = BOX_PAD / scale
      return r && { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 }
    },
    [doc, scale],
  )

  const pointerTool = useMemo<PointerTool | undefined>(() => {
    const editable = () => editableStrokes(readStrokes(doc), readLayers(doc), hiddenLayers)
    const erasable = () =>
      currentLayer ? erasableStrokes(readStrokes(doc), readLayers(doc), currentLayer, hiddenLayers) : editable()
    if (tool === 'eraser') {
      return {
        // 올려 두면 누를 때 지워질 획을 미리 알린다(화면에만 표시, 문서는 그대로)
        hover(p) {
          showEraseTargets(p ? strokesHitBy(erasable(), [p], ERASER_RADIUS) : [])
          return null
        },
        // 끄는 동안은 지나간 획을 흐리게만 보이고, 손을 뗄 때 한 번에 지운다. 손가락으로 두 손가락 스크롤·핀치를
        // 시작할 때 첫 손가락이 닿은 자리의 획이 지워지지 않도록(그때는 cancel이 와서 아무것도 지우지 않는다).
        down(p) {
          const ids = new Set(strokesHitBy(erasable(), [p], ERASER_RADIUS))
          drag.current = { kind: 'erase', last: p, ids }
          showEraseTargets([...ids])
          return true
        },
        move(p) {
          const d = drag.current
          if (d?.kind !== 'erase') return
          const before = d.ids.size
          for (const id of strokesHitBy(erasable(), [d.last, p], ERASER_RADIUS)) d.ids.add(id)
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
      return {
        hover(p) {
          // 손잡이에 올리면 크기·회전 커서, 고른 묶음이나 획 위면 옮기기 커서
          const box = p && selected.length ? selectionBox(selected) : null
          const h = box && p ? handleAt(box, p, HANDLE_HIT / scale, ROTATE_OFFSET / scale) : null
          if (hovered.current !== h) {
            hovered.current = h
            bump()
          }
          if (!p) return null
          if (h) return cursorForHandle(h)
          const inBox = box && p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height
          if (inBox || topStrokeAt(editable(), p, PICK_TOLERANCE)) return 'move'
          return null
        },
        down(p) {
          // 고른 묶음의 손잡이: 모서리는 크기, 위쪽 원은 회전
          const box = selected.length ? selectionBox(selected) : null
          const h = box ? handleAt(box, p, HANDLE_HIT / scale, ROTATE_OFFSET / scale) : null
          if (box && h === 'rotate') {
            const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            drag.current = { kind: 'rotate', ids: selected, bounds: box, center, start: p, m: IDENTITY }
            return true
          }
          if (box && h && h !== 'rotate') {
            drag.current = { kind: 'scale', ids: selected, bounds: box, anchor: anchorOf(box, h), corner: handlePoints(box, 0)[h], m: IDENTITY }
            return true
          }
          const strokes = editable()
          const hit = topStrokeAt(strokes, p, PICK_TOLERANCE)
          if (hit) {
            // 기본 레이어가 아닌 레이어는 스티커처럼 통째로 잡는다
            const ids = selected.includes(hit.id) ? selected : grabIds([hit.id], strokes, readLayers(doc))
            setSelected(ids)
            const bounds = selectionBox(ids) ?? { x: p.x, y: p.y, width: 0, height: 0 }
            drag.current = { kind: 'move', ids, start: p, bounds, m: IDENTITY }
          } else {
            setSelected([])
            drag.current = { kind: 'band', start: p, end: p }
          }
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
          if (d.kind === 'erase') return
          if (d.kind === 'move') d.m = fitted(d.bounds, translate(p.x - d.start.x, p.y - d.start.y))
          else if (d.kind === 'scale') d.m = fitted(d.bounds, scaleAbout(d.anchor.x, d.anchor.y, scaleFactor(d.anchor, d.corner, p)))
          else d.m = fitted(d.bounds, rotateAbout(d.center.x, d.center.y, rotationAngle(d.center, d.start, p)))
          setPreview({ ids: d.ids, m: d.m })
        },
        up() {
          const d = drag.current
          drag.current = null
          if (d?.kind === 'move' || d?.kind === 'scale' || d?.kind === 'rotate') {
            if (d.m.some((v, i) => v !== IDENTITY[i])) transformStrokes(doc, d.ids, d.m, origin)
            setPreview(null)
          }
          if (d?.kind === 'band') {
            const strokes = editable()
            setSelected(grabIds(strokesInRect(strokes, normalizeRect(d.start, d.end)), strokes, readLayers(doc)))
            bump()
          }
        },
      }
    }
    return undefined
  }, [tool, doc, origin, selected, bump, hiddenLayers, scale, selectionBox, currentLayer, showEraseTargets])

  const deleteSelected = useCallback(() => {
    deleteStrokes(doc, selected, origin)
    setSelected([])
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
      const box = selected.length ? selectionBox(selected) : null
      if (!box) {
        ctx.restore()
        return
      }
      const m = preview?.m ?? IDENTITY
      const corners = transformedCorners(box, m)
      // 선택 상자(돌리면 함께 기운다)
      ctx.setLineDash([8 / scale, 6 / scale])
      ctx.beginPath()
      corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
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
    [selected, preview, scale, selectionBox],
  )

  return { pointerTool, overlay, overlayVersion: version, selected, deleteSelected, preview, eraseTargets }
}
