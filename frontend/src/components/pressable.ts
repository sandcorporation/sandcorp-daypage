const PRESSABLE =
  'button, a[href], select, summary, input, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"]'

/** 단추·링크·선택 칸처럼 Enter·Space에 제 동작이 있는 요소(그 안 포함). window 듣개는 이 위의 Enter를 가로채지 않는다. */
export function isPressable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PRESSABLE) !== null
}

/** 초점을 마지막으로 옮긴 입력 방식 */
export type Modality = 'keyboard' | 'pointer'

/**
 * 판정에 쓰는 사건 종류.
 * - pointerdown: 누르기(마우스·펜·손가락)
 * - tab: Tab·Shift+Tab
 * - arrow: 화살표 키(뒤따른 focusin이 있을 때만 초점을 옮긴 것으로 본다)
 * - key: 그 밖의 키(Esc·Enter·Space 등)
 * - focusin: 초점이 들어옴(프로그램 focus() 포함)
 * - pointermove: 포인터 움직임
 */
export type FocusInput = 'pointerdown' | 'tab' | 'arrow' | 'key' | 'focusin' | 'pointermove'

type ModalityState = { modality: Modality; arrow: boolean }

function step(state: ModalityState, input: FocusInput): ModalityState {
  switch (input) {
    case 'pointerdown':
      return { modality: 'pointer', arrow: false }
    case 'tab':
      return { modality: 'keyboard', arrow: false }
    case 'arrow':
      return { modality: state.modality, arrow: true }
    case 'focusin':
      return { modality: state.arrow ? 'keyboard' : state.modality, arrow: false }
    case 'key':
      return { modality: state.modality, arrow: false }
    case 'pointermove':
      return state
  }
}

/**
 * 사건 열에서 마지막으로 초점을 옮긴 입력 방식을 낸다. 키로 닫혀 돌려준 초점·프로그램 focus()는 앞선 방식을 잇는다.
 * Chromium의 :focus-visible은 Esc로 닫힌 뒤 돌려준 초점을 키보드로 보므로 쓰지 않는다(#200).
 */
export function focusModality(inputs: readonly FocusInput[], start: Modality = 'pointer'): Modality {
  return inputs.reduce(step, { modality: start, arrow: false }).modality
}

function inputOf(e: Event): FocusInput {
  if (e.type !== 'keydown') return e.type as FocusInput
  const key = (e as KeyboardEvent).key
  if (key === 'Tab') return 'tab'
  if (key.startsWith('Arrow')) return 'arrow'
  return 'key'
}

let state: ModalityState = { modality: 'pointer', arrow: false }
const track = (e: Event) => (state = step(state, inputOf(e)))
for (const type of ['pointerdown', 'keydown', 'focusin']) document.addEventListener(type, track, true)

/** Space를 요소에 넘길지: 누를 수 있는 요소에 키보드로 초점이 왔거나, 뒤의 화면을 끌 수 없는 모달 창 안일 때. */
export function ownsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || !isPressable(target)) return false
  return state.modality === 'keyboard' || target.closest('[aria-modal="true"]') !== null
}
