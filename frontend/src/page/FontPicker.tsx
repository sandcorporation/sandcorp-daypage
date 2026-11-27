import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { onOutsidePress } from '../components/outsidePress'
import { FONTS, fontOf } from './fonts'

type Props = { font: string; onFont: (id: string) => void }

// 누르는 동안 글 상자 편집기의 포커스를 빼앗지 않는다(편집 중인 상자에 바로 적용하려고).
const keepFocus = (e: PointerEvent) => e.preventDefault()

export function FontPicker({ font, onFont }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const current = fontOf(font)

  useEffect(() => {
    if (!open) return
    return onOutsidePress(
      (t) => ref.current?.contains(t) ?? false,
      () => setOpen(false),
    )
  }, [open])

  return (
    <div className="font-picker" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="tool-btn font-btn"
        aria-label={`글꼴: ${current.name}`}
        title={`글꼴: ${current.name}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onPointerDown={keepFocus}
        onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: current.family }}
      >
        가
      </button>
      {open && (
        <ul className="font-menu" role="listbox" aria-label="글꼴">
          {FONTS.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                role="option"
                aria-selected={f.id === current.id}
                className="font-option"
                onPointerDown={keepFocus}
                onClick={() => {
                  // 키보드로 고르면 초점이 있던 목록이 사라진다(마우스는 keepFocus로 편집기에 남는다)
                  if (ref.current?.contains(document.activeElement)) buttonRef.current?.focus()
                  onFont(f.id)
                  setOpen(false)
                }}
              >
                <span style={{ fontFamily: f.family, fontSize: f.size }}>가나다 Abc</span>
                <span className="font-option-name">{f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
