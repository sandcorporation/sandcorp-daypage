import { useEffect, useRef, useState } from 'react'
import { api } from './api'

/** 조치가 끝난 뒤: 읽어 줄 결과와 초점 자리(반대 동작 단추 또는 상태 제목) */
type Outcome = { message: string; focus: 'reverse' | 'heading' }

/**
 * 노트 닫기·이용 정지처럼 누른 단추가 바뀌는 운영 조치.
 * 새 상태를 받아 그린 뒤 초점을 옮기고 결과를 알린다. 기다리는 동안 단추를 disabled로 두면 초점이 빠지므로,
 * 단추는 aria-disabled로 두고 거듭 누름은 여기서 막는다.
 */
export function useModeration(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Outcome | null>(null)
  const inFlight = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const reverseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!done) return
    const active = document.activeElement
    // 기다리는 동안 다른 곳으로 옮긴 초점은 그대로 둔다
    if (active && active !== document.body && !panelRef.current?.contains(active)) return
    const target = done.focus === 'reverse' ? reverseRef : headingRef
    target.current?.focus()
  }, [done])

  async function act(path: string, outcome: Outcome, body?: unknown) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
      await refresh()
      setDone(outcome)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return { act, busy, error, setError, notice: done?.message ?? '', panelRef, headingRef, reverseRef }
}
