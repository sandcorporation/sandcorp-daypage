import { useCallback, useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { isPageBlank } from '../page/doc'

/** 넘어간 앞 장 */
export type LeftPage = {
  key: string
  /** 기록에 남을 것이 있었나. 새로고침으로 앞 화면이 없으면 모른다(null) */
  written: boolean | null
  /** 노트의 새 페이지 시각이 함께 바뀌었다(만든 사람이 바꿔 넘어갔다) */
  rescheduled: boolean
}

/** 새 버전 때문에 새로고침하기 전에 보고 있던 장의 키를 남기는 자리 */
const reloadMark = (noteId: string) => `daypage:rolledFrom:${noteId}`

// sessionStorage는 저장소를 막은 브라우저에서 던진다. 못 남기면 새로고침 뒤 알림만 빠진다.
function readMark(noteId: string): string | null {
  try {
    return sessionStorage.getItem(reloadMark(noteId))
  } catch {
    return null
  }
}
function removeMark(noteId: string) {
  try {
    sessionStorage.removeItem(reloadMark(noteId))
  } catch {
    // 읽을 수 없으면 지울 것도 없다
  }
}
function writeMark(noteId: string, pageKey: string) {
  try {
    sessionStorage.setItem(reloadMark(noteId), pageKey)
  } catch {
    // 새로고침은 그대로 한다
  }
}

/**
 * 보고 있던 장이 새 장으로 바뀌면 한 번 알린다(#208). 바뀐 길(page_rolled·4409·제 시각 타이머)은 가리지 않는다.
 */
export function useRolledNotice(
  noteId: string,
  pageKey: string,
  sealHour: number,
  doc: Y.Doc,
  notify: (left: LeftPage) => void,
) {
  // 이 화면이 이미 알고 있는 장
  const [firstKey] = useState(() => readMark(noteId) ?? pageKey)
  const told = useRef(firstKey)
  const [holds, setHolds] = useState(0)
  // 장이 바뀌는 render에서 앞 장의 모습을 남긴다
  const shown = useRef({ pageKey, sealHour, doc })
  const left = useRef<LeftPage | null>(null)
  if (shown.current.pageKey !== pageKey) {
    left.current = {
      key: shown.current.pageKey,
      written: !isPageBlank(shown.current.doc),
      rescheduled: shown.current.sealHour !== sealHour,
    }
  }
  shown.current = { pageKey, sealHour, doc }

  useEffect(() => {
    removeMark(noteId)
  }, [noteId])

  useEffect(() => {
    if (holds > 0 || told.current === pageKey) return
    const from = told.current
    told.current = pageKey
    notify(left.current ?? { key: from, written: null, rescheduled: false })
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
  const keepForReload = useCallback(() => writeMark(noteId, pageKey), [noteId, pageKey])

  return { hold, keepForReload }
}
