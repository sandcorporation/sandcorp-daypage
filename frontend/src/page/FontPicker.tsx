import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { FONTS, fontOf } from './fonts'

type Props = { font: string; onFont: (id: string) => void }

// 누르는 동안 글 상자 편집기의 포커스를 빼앗지 않는다(편집 중인 상자에 바로 적용하려고).
const keepFocus = (e: PointerEvent) => e.preventDefault()

export function FontPicker({ font, onFont }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = fontOf(font)

  useEffect(() => {
    if (!open) return
    const close = (e: globalThis.PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="font-picker" ref={ref}>
      <button
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
