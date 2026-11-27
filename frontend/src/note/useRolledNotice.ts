import { useCallback, useEffect, useRef, useState } from 'react'

/** 새 버전 때문에 새로고침하기 전에 보고 있던 장의 키를 남기는 자리 */
const reloadMark = (noteId: string) => `daypage:rolledFrom:${noteId}`

/**
 * 보고 있던 장이 새 장으로 바뀌면 한 번 알린다(#208). 바뀐 길(page_rolled·4409·제 시각 타이머)은 가리지 않는다.
 */
export function useRolledNotice(noteId: string, pageKey: string, notify: () => void) {
  // 이 화면이 이미 알고 있는 장
  const [firstKey] = useState(() => sessionStorage.getItem(reloadMark(noteId)) ?? pageKey)
  const told = useRef(firstKey)
  const [holds, setHolds] = useState(0)

  useEffect(() => {
    sessionStorage.removeItem(reloadMark(noteId))
  }, [noteId])

  useEffect(() => {
    if (holds > 0 || told.current === pageKey) return
    told.current = pageKey
    notify()
  }, [pageKey, holds, notify])

  /**
   * 내가 장을 바꿀 수 있는 저장을 하는 동안 알림을 미룬다. page_rolled가 저장 응답보다 먼저 올 수 있다.
   * 돌려준 함수는 저장이 끝나면 부른다. 저장 결과 글로 이미 말한 장의 키를 넘기면 그 장은 알리지 않는다.
   */
  const hold = useCallback(() => {
    setHolds((n) => n + 1)
    return (saidKey?: string) => {
      if (saidKey) told.current = saidKey
      setHolds((n) => n - 1)
    }
  }, [])

  /** 새로고침하면 화면이 처음부터라, 다시 연 화면이 알릴 수 있게 지금 장을 남긴다 */
  const keepForReload = useCallback(() => sessionStorage.setItem(reloadMark(noteId), pageKey), [noteId, pageKey])

  return { hold, keepForReload }
}
