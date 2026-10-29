import { useCallback, useEffect, useRef, useState } from 'react'

/** 알림에 붙는 버튼 하나(예: 되돌리기). 누르면 알림을 닫는다. */
export type ToastAction = { label: string; onClick: () => void }

/** 버튼이 달린 알림은 누를 틈을 주려고 더 오래 둔다 */
const ACTION_DURATION = 6000

export function useToast(duration = 2200) {
  const [message, setMessage] = useState<{ text: string; action?: ToastAction } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback(
    (text: string, action?: ToastAction) => {
      setMessage({ text, action })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMessage(null), action ? Math.max(duration, ACTION_DURATION) : duration)
    },
    [duration],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const action = message?.action
  const toast = message ? (
    <div className={action ? 'toast toast-action' : 'toast'} role="status" aria-live="polite">
      {message.text}
      {action && (
        <button
          type="button"
          className="toast-btn"
          onClick={() => {
            window.clearTimeout(timer.current)
            setMessage(null)
            action.onClick()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  ) : null

  return { toast, show }
}
