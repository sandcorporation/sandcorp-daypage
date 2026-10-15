import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { deleteStrokes, moveStrokes, readStrokes } from './doc'
import type { Point } from './geometry'
import {
  clampMoveDelta,
  normalizeRect,
  strokeBounds,
  strokesHitBy,
  strokesInRect,
  topStrokeAt,
  unionRect,
  type Rect,
} from './hit'
import type { PointerTool } from './PageView'
import type { ToolKind } from './tools'

const ERASER_RADIUS = 10
const PICK_TOLERANCE = 8

type Drag = { kind: 'move'; ids: string[]; start: Point; bounds: Rect } | { kind: 'band'; start: Point; end: Point } | { kind: 'erase'; last: Point }

/** 지우개와 선택·이동 도구. 그리기·글씨는 다른 곳에서 처리한다. */
export function useEditTools(doc: Y.Doc, tool: ToolKind, origin: unknown) {
  const [selected, setSelected] = useState<string[]>([])
  const [version, setVersion] = useState(0)
  // 끄는 동안에는 문서에 쓰지 않고 화면에서만 옮겨 보인다. 놓을 때 한 번만 저장한다.
  const [preview, setPreview] = useState<{ ids: string[]; dx: number; dy: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // 도구를 바꾸면 선택을 푼다.
  useEffect(() => {
    if (tool !== 'select') setSelected([])
  }, [tool])

  // 다른 사람이 선택한 획을 지우면 선택에서도 뺀다.
  useEffect(() => {
    if (selected.length === 0) return
    const strokes = doc.getMap('strokes')
    const prune = () => setSelected((ids) => ids.filter((id) => strokes.has(id)))
    strokes.observe(prune)
    return () => strokes.unobserve(prune)
  }, [doc, selected.length])

  const pointerTool = useMemo<PointerTool | undefined>(() => {
    if (tool === 'eraser') {
      return {
        down(p) {
          drag.current = { kind: 'erase', last: p }
          deleteStrokes(doc, strokesHitBy(readStrokes(doc), [p], ERASER_RADIUS), origin)
          return true
        },
        move(p) {
          const d = drag.current
          if (d?.kind !== 'erase') return
          deleteStrokes(doc, strokesHitBy(readStrokes(doc), [d.last, p], ERASER_RADIUS), origin)
          d.last = p
        },
        up() {
          drag.current = null
        },
      }
    }
    if (tool === 'select') {
      return {
        down(p) {
          const strokes = readStrokes(doc)
          const hit = topStrokeAt(strokes, p, PICK_TOLERANCE)
          if (hit) {
            const ids = selected.includes(hit.id) ? selected : [hit.id]
            setSelected(ids)
            const byId = new Map(strokes.map((st) => [st.id, st]))
            const bounds = unionRect(ids.flatMap((id) => (byId.has(id) ? [strokeBounds(byId.get(id)!)] : [])))
            drag.current = { kind: 'move', ids, start: p, bounds: bounds ?? { x: p.x, y: p.y, width: 0, height: 0 } }
          } else {
            setSelected([])
            drag.current = { kind: 'band', start: p, end: p }
          }
          return true
        },
        move(p) {
          const d = drag.current
          if (!d) return
          if (d.kind === 'move') {
            const { dx, dy } = clampMoveDelta(d.bounds, p.x - d.start.x, p.y - d.start.y)
            setPreview({ ids: d.ids, dx, dy })
          } else if (d.kind === 'band') {
            d.end = p
            bump()
          }
        },
        up(p) {
          const d = drag.current
          drag.current = null
          if (d?.kind === 'move') {
            const { dx, dy } = clampMoveDelta(d.bounds, p.x - d.start.x, p.y - d.start.y)
            moveStrokes(doc, d.ids, dx, dy, origin)
            setPreview(null)
          }
          if (d?.kind === 'band') {
            setSelected(strokesInRect(readStrokes(doc), normalizeRect(d.start, d.end)))
            bump()
          }
        },
      }
    }
    return undefined
  }, [tool, doc, origin, selected, bump])

  const deleteSelected = useCallback(() => {
    deleteStrokes(doc, selected, origin)
    setSelected([])
  }, [doc, selected, origin])

  const overlay = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const d = drag.current
      let rect: Rect | null = null
      if (d?.kind === 'band') rect = normalizeRect(d.start, d.end)
      else if (selected.length) {
        const byId = new Map(readStrokes(doc).map((s) => [s.id, s]))
        rect = unionRect(selected.flatMap((id) => (byId.has(id) ? [strokeBounds(byId.get(id)!)] : [])))
        const off = preview ?? { dx: 0, dy: 0 }
        if (rect) rect = { x: rect.x - 6 + off.dx, y: rect.y - 6 + off.dy, width: rect.width + 12, height: rect.height + 12 }
      }
      if (!rect) return
      ctx.save()
      ctx.setLineDash([8, 6])
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#2A47B0'
      ctx.fillStyle = 'rgba(42, 71, 176, 0.06)'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
      ctx.restore()
    },
    [doc, selected, preview],
  )

  return { pointerTool, overlay, overlayVersion: version, selected, deleteSelected, preview }
}
