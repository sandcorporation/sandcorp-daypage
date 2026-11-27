import { fireEvent } from '@testing-library/react'
import { type FocusInput, type Modality, focusModality, ownsSpace } from './pressable'

// 초점 결함이 #173·#183·#189·#196·#200 다섯 바퀴 이어졌다. 새 흐름이 나오면 이 표에 줄을 더한다.
// 사건 열은 브라우저가 보내는 차례 그대로다(키로 닫히며 돌려준 초점은 key 뒤의 focusin).
const flows: [string, FocusInput[], Modality][] = [
  ['클릭→Space', ['pointerdown', 'focusin', 'key'], 'pointer'],
  ['클릭→팝오버→Esc→Space', ['pointerdown', 'focusin', 'focusin', 'key', 'focusin', 'key'], 'pointer'],
  ['클릭→확인 창→Esc→Space', ['pointerdown', 'focusin', 'pointerdown', 'focusin', 'key', 'focusin', 'key'], 'pointer'],
  ['곡선 단추 클릭→Esc→Space', ['pointerdown', 'focusin', 'key', 'focusin', 'key'], 'pointer'],
  ['Tab→Space', ['tab', 'focusin', 'key'], 'keyboard'],
  ['Tab→마우스 이동만→Space', ['tab', 'focusin', 'pointermove', 'pointermove', 'key'], 'keyboard'],
  ['Tab→Enter로 팝오버→Esc→Space', ['tab', 'focusin', 'key', 'focusin', 'key', 'focusin', 'key'], 'keyboard'],
  ['Tab→같은 단추를 클릭→Space', ['tab', 'focusin', 'pointerdown', 'key'], 'pointer'],
  ['클릭→Tab→Space', ['pointerdown', 'focusin', 'tab', 'focusin', 'key'], 'keyboard'],
  ['클릭→화살표로 초점 이동→Space', ['pointerdown', 'focusin', 'arrow', 'focusin', 'key'], 'keyboard'],
  ['클릭→초점을 옮기지 않는 화살표→Space', ['pointerdown', 'focusin', 'arrow', 'key'], 'pointer'],
  ['클릭→화살표→키→프로그램 초점→Space', ['pointerdown', 'focusin', 'arrow', 'key', 'focusin', 'key'], 'pointer'],
  ['입력 없이 프로그램 초점→Space', ['focusin', 'key'], 'pointer'],
]

test.each(flows)('%s → %s', (_, inputs, expected) => {
  expect(focusModality(inputs)).toBe(expected)
})

test('#200 마우스로 연 창을 Esc로 닫아 돌아온 초점의 Space는 단추의 것이 아니다', () => {
  document.body.innerHTML = '<button>굵기</button><div role="dialog"><button>닫기</button></div>'
  const [opener, inner] = document.querySelectorAll('button')
  fireEvent.pointerDown(opener)
  opener.focus()
  inner.focus()
  fireEvent.keyDown(inner, { key: 'Escape' })
  opener.focus()
  expect(ownsSpace(opener)).toBe(false)

  fireEvent.keyDown(opener, { key: 'Tab' })
  inner.focus()
  fireEvent.keyDown(inner, { key: 'Escape' })
  opener.focus()
  expect(ownsSpace(opener)).toBe(true)
})
