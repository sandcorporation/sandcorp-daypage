import { useState, type PointerEvent, type ReactNode } from 'react'
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './color'

export type ColorFieldState = {
  hsv: Hsv
  text: string
  /** 색 코드가 올바르면 '#rrggbb', 아니면 null */
  color: string | null
  setFromHsv: (next: Hsv) => void
  setFromText: (value: string) => void
}

/** 색판·색상 띠·색 코드 입력이 함께 쓰는 상태. 처음 색은 initial. */
export function useColorField(initial: string): ColorFieldState {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial))
  const [text, setText] = useState(initial)
  return {
    hsv,
    text,
    color: normalizeHex(text),
    setFromHsv: (next) => {
      setHsv(next)
      setText(hsvToHex(next))
    },
    setFromText: (value) => {
      setText(value)
      const hex = normalizeHex(value)
      if (hex) setHsv(hexToHsv(hex))
    },
  }
}

/** 색판(채도·명도)·색상 띠·미리보기와 색 코드 입력. sample은 색 코드 옆에 둘 견본(예: 잉크 획). */
export function ColorField({ field, sample }: { field: ColorFieldState; sample?: ReactNode }) {
  const { hsv, text, color, setFromHsv, setFromText } = field

  function onPlane(e: PointerEvent<HTMLDivElement>) {
    if (e.type === 'pointermove' && e.buttons === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height))
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
    setFromHsv({ ...hsv, s, v })
  }

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 })
  return (
    <>
      <div
        className="color-plane"
        aria-hidden="true"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
        onPointerDown={onPlane}
        onPointerMove={onPlane}
      >
        <span className="color-plane-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <input
        type="range"
        className="color-hue"
        aria-label="색상"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        onChange={(e) => setFromHsv({ ...hsv, h: Number(e.target.value) })}
      />
      <div className="color-row">
        <span className="color-preview" style={{ background: color ?? 'transparent' }} />
        <label className="color-code">
          색 코드
          <input type="text" value={text} spellCheck={false} onChange={(e) => setFromText(e.target.value)} aria-invalid={!color} />
        </label>
        {sample}
      </div>
    </>
  )
}
