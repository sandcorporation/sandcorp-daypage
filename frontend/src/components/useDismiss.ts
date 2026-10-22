import { useEffect, type RefObject } from 'react'

/** 열린 팝오버를 바깥을 누르거나 Escape로 닫는다. ref는 팝오버와 그 버튼을 감싼 요소. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onEvent = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('pointerdown', onEvent)
    window.addEventListener('keydown', onEvent)
    return () => {
      window.removeEventListener('pointerdown', onEvent)
      window.removeEventListener('keydown', onEvent)
    }
  }, [ref, open, close])
}
