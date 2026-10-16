import { useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from './useRealtime'

/** index.html에서 앱 번들 이름(/assets/index-해시.js)을 찾는다. 개발 서버처럼 없으면 null. */
export function bundleOf(html: string): string | null {
  return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null
}

/** 지금 화면이 불러온 번들 */
function loadedBundle(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')
  return src ? bundleOf(src) : null
}

/**
 * 서버에 새 버전이 올라왔는지. 배포하면 연결이 잠깐 끊겼다 다시 붙으므로 그때, 그리고 탭으로 돌아올 때
 * 서버의 index.html을 받아 지금 번들과 비교한다.
 */
export function useNewVersion(status: ConnectionStatus): boolean {
  const [stale, setStale] = useState(false)
  const wasDown = useRef(false)

  useEffect(() => {
    const current = loadedBundle()
    if (!current || stale) return
    const check = async () => {
      try {
        const res = await fetch('/', { cache: 'no-store' })
        const latest = bundleOf(await res.text())
        if (latest && latest !== current) setStale(true)
      } catch {
        // 다음 기회에 다시 본다.
      }
    }
    if (status === 'connected' && wasDown.current) void check()
    wasDown.current = status === 'reconnecting' || status === 'offline'
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [status, stale])

  return stale
}
