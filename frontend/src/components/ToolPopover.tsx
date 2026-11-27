import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { placePopover, type PopoverSide } from './popoverPlacement'
import { useIsPhone } from './useIsPhone'

/** 안에서 여는 도구 창을 버튼의 어느 쪽에 열지(도구 막대가 붙은 가장자리의 반대쪽). 기본은 오른쪽. */
export const PopoverSideContext = createContext<PopoverSide>('right')

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

  // 바깥 누르기로 닫을 때는 누른 자리를 따른다
  const outside = useRef(false)
  // 창 안에서 초점이 있던 요소가 사라지거나 바뀌면 창에, 고른 뒤 창째 닫히면 연 버튼에 초점을 둔다.
  // layout 효과의 정리는 창이 DOM에서 빠지기 전에 돌아 초점이 안에 있었는지 알 수 있다.
  useLayoutEffect(() => {
    const dialog = ref.current!
    const anchorEl = anchor.current
    let held: Node | null = null
    const onFocusIn = (e: FocusEvent) => {
      outside.current = false
      held = e.target as Node
    }
    dialog.addEventListener('focusin', onFocusIn)
    const observer = new MutationObserver(() => {
      if (held && !held.isConnected && document.activeElement === document.body) dialog.focus()
    })
    observer.observe(dialog, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      dialog.removeEventListener('focusin', onFocusIn)
      if (outside.current || !dialog.contains(document.activeElement)) return
      queueMicrotask(() => {
        if (document.activeElement === document.body && anchorEl?.isConnected) anchorEl.focus()
      })
    }
  }, [anchor])

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
      outside.current = true
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

  // 데스크톱: 버튼 옆(도구 막대를 붙인 가장자리의 반대쪽)에 붙이되 화면 안에 들어오게 민다.
  const side = useContext(PopoverSideContext)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (phone) return
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      const el = ref.current
      if (!a || !el) return
      const size = { width: el.offsetWidth, height: el.offsetHeight }
      setPos(placePopover(a, size, { width: window.innerWidth, height: window.innerHeight }, side, align))
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
  }, [phone, anchor, align, side])

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
