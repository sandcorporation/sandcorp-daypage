import { useEffect, useState } from 'react'

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
