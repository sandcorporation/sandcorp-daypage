import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

/** 도구 막대가 가로로 바뀌는 폭(note.css와 같은 값). 이보다 좁으면 창을 아래 시트로 연다. */
export const PHONE_QUERY = '(max-width: 720px)'

function matchPhone(): boolean {
  try {
    return window.matchMedia?.(PHONE_QUERY).matches ?? false
  } catch {
    return false
  }
}

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(matchPhone)
  useEffect(() => {
    let mq: MediaQueryList | undefined
    try {
      mq = window.matchMedia?.(PHONE_QUERY)
    } catch {
      return
    }
    if (!mq) return
    const update = () => setPhone(mq!.matches)
    mq.addEventListener?.('change', update)
    return () => mq!.removeEventListener?.('change', update)
  }, [])
  return phone
}

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
 * 여는 쪽이 열림 상태를 갖고, 버튼과 이 창을 position: relative인 감싸개 안에 함께 둔다.
 */
export function ToolPopover({ title, anchor, onClose, children, align = 'top', className }: Props) {
  const phone = useIsPhone()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

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

  const variant = phone ? 'sheet' : 'popover'
  return (
    <>
      {phone && <div className="sheet-backdrop" aria-hidden="true" />}
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        data-variant={variant}
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
    </>
  )
}
