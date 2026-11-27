// 팝오버를 바깥 누르기로 닫는 공용 길(#206). 닫는 누르기에는 표시를 남겨, 지면이 그 누르기로는 그리지 않게 한다.
// 표시는 캡처 단계에서 남긴다: 지면의 React 처리기는 window의 버블 듣개(닫기)보다 먼저 돈다.
// 닫기는 버블 단계다: 위에 뜬 창이 stopPropagation으로 뒤의 팝오버를 지킨다(ConfirmDialog).

const closing = new WeakSet<Event>()

/** 이 누르기가 열린 팝오버를 바깥 누르기로 닫는가 */
export const closesPopover = (e: Event): boolean => closing.has(e)

/** 열려 있는 동안 건다. inside 밖을 누르면 close. 돌려주는 함수로 푼다. */
export function onOutsidePress(inside: (target: Node) => boolean, close: () => void): () => void {
  const mark = (e: PointerEvent) => {
    if (!inside(e.target as Node)) closing.add(e)
  }
  const dismiss = (e: PointerEvent) => {
    if (!inside(e.target as Node)) close()
  }
  window.addEventListener('pointerdown', mark, true)
  window.addEventListener('pointerdown', dismiss)
  return () => {
    window.removeEventListener('pointerdown', mark, true)
    window.removeEventListener('pointerdown', dismiss)
  }
}
