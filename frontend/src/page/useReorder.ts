import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const IDLE = { dragging: null, over: null, above: false }

/** 줄을 끌기로 보기 전에 이만큼(px) 움직여야 한다(그보다 적으면 누르기) */
export const REORDER_SLOP = 6

type Drag = {
  id: string
  pointerId: number
  startY: number
  /** 손잡이에서 시작했으면 바로 끌기, 줄에서 시작했으면 SLOP을 넘어야 끌기 */
  active: boolean
  /** 끌기를 시작할 때 잰 줄들의 세로 자리(보이는 순서) */
  rows: { id: string; top: number; bottom: number }[]
  over: string | null
}

/**
 * 목록 줄 순서 바꾸기(레이어·사진 패널). HTML5 끌어 놓기는 아이패드·휴대폰 손가락으로는 거의 되지 않아
 * 포인터 이벤트로 직접 한다. 마우스·펜은 줄 어디서든, 손가락은 손잡이(touch-action: none)에서 끈다
 * (줄을 손가락으로 끌면 목록이 스크롤된다). 놓으면 onReorder(옮긴 id, 놓은 자리의 id).
 */
export function useReorder(onReorder: (from: string, to: string) => void) {
  const rows = useRef(new Map<string, HTMLElement>())
  const drag = useRef<Drag | null>(null)
  // 끄는 줄, 놓을 자리의 줄, 그 자리가 끄는 줄보다 위인지(위면 위쪽 선, 아래면 아래쪽 선)
  const [view, setView] = useState<{ dragging: string | null; over: string | null; above: boolean }>(IDLE)
  // 줄을 끌고 난 뒤 따라오는 click(줄 고르기)을 한 번 막는다
  const swallowClick = useRef(false)
  const reorder = useRef(onReorder)
  useEffect(() => {
    reorder.current = onReorder
  })

  const stop = useRef<() => void>(() => {})

  const begin = useCallback((id: string, e: ReactPointerEvent, fromHandle: boolean) => {
    if (e.button > 0 || drag.current) return
    const measured = [...rows.current.entries()]
      .map(([rid, el]) => {
        const r = el.getBoundingClientRect()
        return { id: rid, top: r.top, bottom: r.bottom }
      })
      .sort((a, b) => a.top - b.top)
    drag.current = { id, pointerId: e.pointerId, startY: e.clientY, active: fromHandle, rows: measured, over: null }
    if (fromHandle) {
      // 손잡이를 누른 채로 글자 선택·스크롤이 일어나지 않게
      e.preventDefault()
      setView({ dragging: id, over: null, above: false })
    }
    const move = (ev: PointerEvent) => {
      const d = drag.current
      if (!d || ev.pointerId !== d.pointerId) return
      if (!d.active) {
        if (Math.abs(ev.clientY - d.startY) < REORDER_SLOP) return
        d.active = true
      }
      ev.preventDefault()
      const first = d.rows[0]
      const last = d.rows[d.rows.length - 1]
      const hit =
        d.rows.find((r) => ev.clientY >= r.top && ev.clientY < r.bottom) ??
        (first && ev.clientY < first.top ? first : last)
      const over = hit && hit.id !== d.id ? hit.id : null
      d.over = over
      const at = (rid: string | null) => d.rows.findIndex((r) => r.id === rid)
      const above = at(over) < at(d.id)
      setView((v) => (v.dragging === d.id && v.over === over && v.above === above ? v : { dragging: d.id, over, above }))
    }
    const up = (ev: PointerEvent) => {
      const d = drag.current
      if (!d || ev.pointerId !== d.pointerId) return
      const done = ev.type === 'pointerup' && d.active && d.over
      if (d.active && !fromHandle) swallowClick.current = true
      stop.current()
      if (done) reorder.current(d.id, d.over!)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    stop.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      drag.current = null
      setView(IDLE)
    }
  }, [])

  useEffect(() => () => stop.current(), [])

  /** 줄(li)에 펼친다. 마우스·펜은 줄 어디서든 끌 수 있다. */
  const rowProps = (id: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) rows.current.set(id, el)
      else rows.current.delete(id)
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return
      // 입력 칸(이름 바꾸기) 안에서 누른 것은 글 편집이다
      if ((e.target as HTMLElement).closest('input, textarea')) return
      begin(id, e, false)
    },
    onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  })

  /** 손잡이 버튼에 펼친다. 손가락으로도 바로 끈다. */
  const handleProps = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent) => begin(id, e, true),
  })

  /** 끄는 줄은 흐리게, 놓을 자리는 위·아래 선으로 보인다 */
  const rowClass = (id: string): string | false => {
    if (view.dragging === id) return 'dragging'
    if (view.over !== id || !view.dragging) return false
    return view.above ? 'drop-above' : 'drop-below'
  }

  return { rowProps, handleProps, rowClass }
}
