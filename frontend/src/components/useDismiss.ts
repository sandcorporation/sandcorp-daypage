import { useEffect, type RefObject } from 'react'
import { onOutsidePress } from './outsidePress'

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escape()
    }
    const offPress = onOutsidePress((t) => ref.current?.contains(t) ?? false, close)
    window.addEventListener('keydown', onKey)
    return () => {
      offPress()
      window.removeEventListener('keydown', onKey)
    }
  }, [ref, open, close, escape])
}
