import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useIsPhone } from './useIsPhone'

type Props = {
  title: string
  /** 창을 연 버튼. 닫으면 포커스를 돌려주고, 이 버튼을 누른 것은 바깥 누르기로 치지 않는다. */
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  /** 데스크톱 팝오버를 버튼 위쪽에 맞출지 아래쪽에 맞출지(도구 막대 아래쪽 버튼은 'bottom') */
  align?: 'top' | 'bottom'
  className?: string
}

/**
 * 도구 막대 버튼에서 여는 창. 데스크톱에서는 버튼 옆 팝오버, 폰 폭에서는 아래에서 올라오는 시트.
 * 여는 쪽이 열림 상태를 갖는다. 창은 body에 붙여 그린다: 도구 막대(가로 스크롤·쌓임 맥락) 안에 두면
 * 폰에서 잘리거나 확대·연결 표시 아래로 깔린다.
 */
export function ToolPopover({ title, anchor, onClose, children, align = 'top', className }: Props) {
  const phone = useIsPhone()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const anchorEl = anchor.current
    const close = () => {
      closeRef.current()
      anchorEl?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchorEl?.contains(t)) return
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    ref.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [anchor])

  // 데스크톱: 버튼 오른쪽에 붙이되 화면 안에 들어오게 위아래를 맞춘다(아래쪽 버튼에서 열어도 잘리지 않게).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (phone) return
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      const el = ref.current
      if (!a || !el) return
      const margin = 8
      const h = el.offsetHeight
      const w = el.offsetWidth
      // 오른쪽에 자리가 없으면(머리글 오른쪽 끝의 버튼 등) 버튼 아래에 오른쪽 끝을 맞춰 연다
      if (a.right + 12 + w > window.innerWidth - margin) {
        const top = Math.min(a.bottom + 8, window.innerHeight - h - margin)
        setPos({ top: Math.max(margin, top), left: Math.max(margin, a.right - w) })
        return
      }
      const wanted = align === 'bottom' ? a.bottom - h : a.top
      // 위쪽은 노트 머리말(약 64px) 아래로
      const top = Math.max(72, Math.min(wanted, window.innerHeight - h - margin))
      setPos({ top, left: a.right + 12 })
    }
    place()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (ref.current) observer?.observe(ref.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [phone, anchor, align])

  const variant = phone ? 'sheet' : 'popover'
  return createPortal(
    <>
      {phone && <div className="sheet-backdrop" aria-hidden="true" />}
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        data-variant={variant}
        style={pos ? { top: pos.top, left: pos.left } : undefined}
        className={`tool-pop tool-pop-${variant} tool-pop-${align}${className ? ` ${className}` : ''}`}
      >
        <div className="tool-pop-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="tool-pop-close"
            aria-label="닫기"
            onClick={() => {
              onClose()
              anchor.current?.focus()
            }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  )
}
