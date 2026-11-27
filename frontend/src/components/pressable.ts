const PRESSABLE =
  'button, a[href], select, summary, input, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"]'

/** 단추·링크·선택 칸처럼 Enter·Space에 제 동작이 있는 요소(그 안 포함). window 듣개는 이 위의 키를 가로채지 않는다. */
export function isPressable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PRESSABLE) !== null
}
