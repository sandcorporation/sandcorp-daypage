import { useCallback, useEffect, useRef, useState } from 'react'

export function useToast(duration = 2200) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback(
    (text: string) => {
      setMessage(text)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMessage(null), duration)
    },
    [duration],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const toast = message ? (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  ) : null

  return { toast, show }
}
