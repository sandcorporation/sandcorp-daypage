import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { PopoverSideContext, ToolPopover } from '../components/ToolPopover'
import { displayName, initial, type Person } from './people'

type Props = {
  people: Person[]
  /** 얼굴로 보이지 못한 사람 수 */
  hidden: number
  /** 목록이 열린 채 숨은 사람이 없어져 이 단추가 사라질 때 초점을 받을 자리 */
  fallback: RefObject<HTMLElement | null>
}

/** 「+N」 단추. 누르면 함께 있는 사람 전부의 닉네임 목록이 열린다. 창은 body에 떠서 머리글 높이를 바꾸지 않는다. */
export function PeopleMore({ people, hidden, fallback }: Props) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

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

  useLayoutEffect(() => {
    const el = button.current
    const target = fallback
    return () => {
      const active = document.activeElement
      if (active !== el && !active?.closest('.people-pop')) return
      queueMicrotask(() => {
        if (document.activeElement === document.body) target.current?.focus()
      })
    }
  }, [fallback])

  return (
    <>
      <button
        ref={button}
        type="button"
        className="avatar avatar-more"
        aria-label={`함께 있는 사람 ${people.length}명 모두 보기`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        +{hidden}
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
