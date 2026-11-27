const PRESSABLE =
  'button, a[href], select, summary, input, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"]'

/** 단추·링크·선택 칸처럼 Enter·Space에 제 동작이 있는 요소(그 안 포함). window 듣개는 이 위의 Enter를 가로채지 않는다. */
export function isPressable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PRESSABLE) !== null
}

// :focus-visible은 초점이 들어온 순간에만 읽는다. Chromium은 마우스로 누른 단추도 키를 누르는 즉시(keydown 듣개에서도)
// 맞는 것으로 바꾼다. 이미 초점이 있는 단추를 마우스로 다시 누르면 focusin이 없으므로 pointerdown에서 잊는다.
let keyboardFocused: EventTarget | null = null
document.addEventListener(
  'focusin',
  (e) => {
    keyboardFocused = e.target instanceof Element && e.target.matches(':focus-visible') ? e.target : null
  },
  true,
)
document.addEventListener('pointerdown', () => (keyboardFocused = null), true)

/** Space를 요소에 넘길지: 누를 수 있는 요소에 키보드로 초점이 왔거나, 뒤의 화면을 끌 수 없는 모달 창 안일 때. */
export function ownsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !isPressable(target)) return false
  return target === keyboardFocused || target.closest('[aria-modal="true"]') !== null
}
