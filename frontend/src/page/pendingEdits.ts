import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * 놓아야 문서에 쓰는 끌기(옮기기·크기·돌리기·지우개·목록 순서). 놓기 전에 장이 바뀌면 어느 장에도 남지 않아
 * 「저장되지 않은 n개」에 센다(#280, note/rollover.ts).
 */

/** 놓지 않은 편집이 있으면 버리고 true. 장이 바뀌는 render 중에 부르므로 상태를 바꾸지 않고 ref만 만진다. */
type Take = () => boolean

const takers = new Set<{ current: Take }>()

/** 지금 놓지 않은 편집을 모두 버리고 그 수를 돌려준다 */
export function takePendingEdits(): number {
  let count = 0
  for (const take of takers) if (take.current()) count += 1
  return count
}

export function usePendingEdit(take: Take) {
  const latest = useRef(take)
  // 화면에 반영된 값을 본다: 장이 바뀌는 render에서는 아직 앞 장의 것이어야 한다
  useLayoutEffect(() => {
    latest.current = take
  })
  useEffect(() => {
    takers.add(latest)
    return () => void takers.delete(latest)
  }, [])
}
