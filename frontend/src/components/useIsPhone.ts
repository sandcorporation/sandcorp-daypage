import { useEffect, useState } from 'react'

/** 도구 막대가 가로로 바뀌는 폭(note.css와 같은 값). 이보다 좁으면 창을 아래 시트로 연다. */
export const PHONE_QUERY = '(max-width: 720px)'

function matches(query: string): boolean {
  try {
    return window.matchMedia?.(query).matches ?? false
  } catch {
    return false
  }
}

export function useMediaQuery(query: string): boolean {
  const [matched, setMatched] = useState(() => matches(query))
  useEffect(() => {
    let mq: MediaQueryList | undefined
    try {
      mq = window.matchMedia?.(query)
    } catch {
      return
    }
    if (!mq) return
    const update = () => setMatched(mq!.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq!.removeEventListener?.('change', update)
  }, [query])
  return matched
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}
