import { useEffect, type RefObject } from 'react'
import { useLocation } from 'react-router'

/** 동작(노트 만들기·지우기) 끝에 화면을 옮길 때 navigate에 넘긴다. */
export const ARRIVE_AT_TITLE = { state: { focusTitle: true } }

/** 옮겨 온 화면이 받는 것. notice는 앞 화면에서 한 일을 알리는 글 */
export type ArrivalState = { focusTitle?: boolean; notice?: string } | null

export const noteDeletedNotice = (name: string) => `‘${name}’ 노트를 지웠어요`

/** 그렇게 옮겨 온 화면은 제목(tabIndex=-1)에 초점을 둔다. 링크로 들어온 때는 두지 않는다. */
export function useFocusOnArrival(title: RefObject<HTMLElement | null>): void {
  const { state } = useLocation()
  const wanted = (state as ArrivalState)?.focusTitle === true
  useEffect(() => {
    if (wanted) title.current?.focus()
  }, [title, wanted])
}
