import { useCallback, useRef, useState } from 'react'
import { PopoverSideContext, ToolPopover } from '../components/ToolPopover'
import { displayName, initial, type Person } from './people'

type Props = {
  people: Person[]
  /** 얼굴로 보이는 사람 수. 나머지는 「+N」으로 묶는다 */
  faces: number
}

/** 함께 있는 사람 얼굴 묶음. 누르면 모두의 닉네임 목록이 열린다. 창은 body에 떠서 머리글 높이를 바꾸지 않는다. */
export function PeopleButton({ people, faces }: Props) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const hidden = people.length - faces

  const close = useCallback(() => {
    setOpen(false)
    // 바깥 누르기가 아무것도 잡지 않았으면 초점을 단추로 돌린다. 초점은 pointerdown 뒤에 옮겨 가므로 click에서 본다.
    // 끌기처럼 click이 없는 누르기의 듣개는 다음 누르기에서 거둔다.
    const off = () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('pointerdown', off)
    }
    const onClick = () => {
      off()
      if (document.activeElement === document.body) button.current?.focus()
    }
    window.addEventListener('click', onClick)
    window.addEventListener('pointerdown', off)
  }, [])

  return (
    <>
      <button
        ref={button}
        type="button"
        className="avatars-button"
        aria-label={`함께 있는 사람 ${people.length}명 — 목록 보기`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {people.slice(0, faces).map((p, i) => (
          // 얼굴의 머리글자만으로는 누구인지 알 수 없어, 마우스에는 툴팁으로 닉네임을 보인다
          <span key={`${p.nickname}-${i}`} className="avatar" title={displayName(p)} style={{ background: p.color }}>
            {initial(p.nickname)}
          </span>
        ))}
        {hidden > 0 && <span className="avatar avatar-more">+{hidden}</span>}
      </button>
      {open && (
        <PopoverSideContext.Provider value="below">
          <ToolPopover
            title={`함께 있는 사람 ${people.length}명`}
            anchor={button}
            onClose={close}
            className="people-pop"
          >
            <ul className="people-list">
              {people.map((p, i) => (
                <li key={`${p.nickname}-${i}`}>
                  <span className="avatar" aria-hidden="true" style={{ background: p.color }}>
                    {initial(p.nickname)}
                  </span>
                  <span className="people-name">{displayName(p)}</span>
                </li>
              ))}
            </ul>
          </ToolPopover>
        </PopoverSideContext.Provider>
      )}
    </>
  )
}
