import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * 화면 바닥의 칩·보기 칸을 담는 영역. 폭이 모자라면 CSS 흐름이 위로 쌓는다.
 * 그 위에 뜨는 것(아래 도구 막대·곡선 막대·지면 끝 여백)이 비켜서도록 잰 높이를 --note-chips-h로 알린다.
 */
export function BottomArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const update = () => root.style.setProperty('--note-chips-h', `${el.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--note-chips-h')
    }
  }, [])
  return (
    <div ref={ref} className="bottom-area">
      {children}
    </div>
  )
}
