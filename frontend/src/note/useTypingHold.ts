import { useCallback, useEffect, useRef } from 'react'

/**
 * 글 상자에 쓰던 중 장이 바뀌면 편집 칸이 사라져 초점이 body로 간다. 이어 치는 글자가 단축키가 되지 않게(#272),
 * 다음 포인터 입력이나 Tab 전까지 Ctrl(⌘)·Alt 없는 키를 단축키로 받지 않는다.
 * 돌려준 함수는 이 키 조합을 지금 무시해야 하는지 알려 준다.
 */
export function useTypingHold(pageKey: string): (combo: string) => boolean {
  const held = useRef(false)
  const shown = useRef(pageKey)
  // 그리는 중에 본다: 이때는 앞 장의 편집 칸이 아직 화면에 있다. effect에서는 이미 사라진 뒤다.
  if (shown.current !== pageKey) {
    shown.current = pageKey
    if (document.activeElement?.closest('.textbox')) held.current = true
  }

  useEffect(() => {
    const release = () => {
      held.current = false
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') release()
    }
    window.addEventListener('pointerdown', release, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', release, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  return useCallback((combo: string) => held.current && !/^(Mod|Alt)\+/.test(combo), [])
}
