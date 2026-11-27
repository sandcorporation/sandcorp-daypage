import { useEffect, type RefObject } from 'react'

/** 열린 팝오버를 바깥을 누르거나 Escape로 닫는다. ref는 팝오버와 그 버튼을 감싼 요소.
 * Escape로 닫을 때만 다르게 해야 하면(초점 돌리기) escape를 준다. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
  escape: () => void = close,
): void {
  useEffect(() => {
    if (!open) return
    const onEvent = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') escape()
      } else if (!ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('pointerdown', onEvent)
    window.addEventListener('keydown', onEvent)
    return () => {
      window.removeEventListener('pointerdown', onEvent)
      window.removeEventListener('keydown', onEvent)
    }
  }, [ref, open, close, escape])
}
