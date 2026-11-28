import { useCallback, useEffect, useRef, useState } from 'react'
import { focusSpot } from './focusSpot'

/** 알림에 붙는 버튼 하나(예: 되돌리기). 누르면 알림을 닫는다. */
export type ToastAction = { label: string; onClick: () => void }

/** 버튼이 달린 알림은 누를 틈을 주려고 더 오래 둔다 */
const ACTION_DURATION = 6000
/** 놓치면 안 되는 알림(keep)은 다음 입력까지 두고, 그 뒤로도 이만큼 둔다(#280) */
export const KEPT_AFTER_INPUT_MS = 10_000

export function useToast(duration = 2200) {
  const [message, setMessage] = useState<{ text: string; action?: ToastAction; keep?: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const keptNow = useRef<string | null>(null)

  const hide = useCallback(() => {
    keptNow.current = null
    window.clearTimeout(timer.current)
    setMessage(null)
  }, [])

  /** keep을 주면 시간이 아니라 다음 입력부터 세어 사라진다. 값은 지금 떠 있는지 kept()로 묻는 이름이다. */
  const show = useCallback(
    (text: string, action?: ToastAction, keep?: string) => {
      keptNow.current = keep ?? null
      setMessage({ text, action, keep })
      window.clearTimeout(timer.current)
      if (!keep) timer.current = window.setTimeout(hide, action ? Math.max(duration, ACTION_DURATION) : duration)
    },
    [duration, hide],
  )
  const kept = useCallback(() => keptNow.current, [])

  useEffect(() => {
    if (!message?.keep) return
    const types = ['pointerdown', 'keydown'] as const
    const stopListening = () => types.forEach((t) => window.removeEventListener(t, onInput, true))
    function onInput() {
      stopListening()
      timer.current = window.setTimeout(hide, KEPT_AFTER_INPUT_MS)
    }
    types.forEach((t) => window.addEventListener(t, onInput, true))
    return stopListening
  }, [message, hide])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // 실행 단추는 알림과 함께 사라진다. 단추로 오기 전에 있던 자리로 초점을 돌려준다.
  const cameFrom = useRef<Element | null>(null)
  const action = message?.action
  // live 영역은 늘 둔다. 글과 함께 새로 생긴 영역은 화면 낭독기가 읽지 않을 수 있다.
  const toast = (
    <div className={!message ? 'visually-hidden' : action ? 'toast toast-action' : 'toast'} role="status" aria-live="polite">
      {message?.text}
      {action && (
        <button
          type="button"
          className="toast-btn"
          onFocus={(e) => (cameFrom.current = e.relatedTarget)}
          onClick={(e) => {
            if (document.activeElement === e.currentTarget) {
              const back = cameFrom.current
              if (back instanceof HTMLElement && back.isConnected) back.focus()
              else focusSpot(document.querySelector('main'))
            }
            hide()
            action.onClick()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )

  return { toast, show, kept }
}
