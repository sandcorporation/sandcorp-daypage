import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  /** 닫을 때 창을 연 단추가 사라졌으면 대신 초점을 둘 자리 */
  fallbackFocus?: () => HTMLElement | null
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'

/**
 * 되돌릴 수 없는 일을 하기 전에 묻는 창. 실수로 누르지 않도록 처음 포커스는 취소에 둔다.
 * 열려 있는 동안 Tab은 창 안에서 돌고, 닫히면 초점을 창을 연 단추로 돌려준다.
 */
export function ConfirmDialog({ title, children, confirmLabel, busy = false, onConfirm, onCancel, fallbackFocus }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // 부르는 쪽이 그릴 때마다 새 함수를 넘겨도 초점 효과는 열릴 때와 닫힐 때만 돈다.
  const handlers = useRef({ onCancel, fallbackFocus })
  useLayoutEffect(() => {
    handlers.current = { onCancel, fallbackFocus }
  })

  useEffect(() => {
    const dialog = dialogRef.current!
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Tab') return
      // 뒤에 열린 도구 창이나 화면 단축키가 같은 키를 받지 않게 먼저 잡고 멈춘다
      e.stopPropagation()
      e.preventDefault()
      if (e.key === 'Escape') return handlers.current.onCancel()
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return dialog.focus()
      const at = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length
      items[next].focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const now = document.activeElement
      // 닫으면서 부르는 쪽이 다른 자리(새 제목 등)로 옮겼으면 그대로 둔다
      if (now && now !== document.body && !dialog.contains(now)) return
      const target = opener?.isConnected && opener !== document.body ? opener : handlers.current.fallbackFocus?.()
      target?.focus()
    }
  }, [])

  // 요청하는 동안 disabled가 된 단추는 초점을 잃는다. 실패해 창이 남으면 취소로 되돌린다.
  useEffect(() => {
    if (!busy && !dialogRef.current?.contains(document.activeElement)) cancelRef.current?.focus()
  }, [busy])

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return
        // 누른 자리(body)로 초점이 옮겨 가지 않게 막는다
        e.preventDefault()
        // 창이 먼저 사라지므로, 뒤에 열린 도구 창이 이 누르기를 바깥 누르기로 보고 닫지 않게 한다
        e.stopPropagation()
        onCancel()
      }}
    >
      <div ref={dialogRef} className="dialog card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabIndex={-1}>
        <h2 id="confirm-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? '지우는 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
