/**
 * 누른 단추가 곧 사라질 때, 초점을 받을 수 없는 자리(지면 등)에 초점을 둔다.
 * 그 동안만 tabIndex를 줘서, 평소 지면 누르기가 초점을 옮기지 않게 한다.
 */
export function focusSpot(el: HTMLElement | null): void {
  if (!el) return
  el.tabIndex = -1
  el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true })
  el.focus({ preventScroll: true })
}
