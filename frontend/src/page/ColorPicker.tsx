import { useState, type PointerEvent } from 'react'
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './color'

export const MAX_NOTE_COLORS = 8

/** 기본 잉크와 잘 어울리는 추천 색 */
export const RECOMMENDED_COLORS = ['#16794f', '#0e7490', '#7c3aed', '#db2777', '#b45309', '#65a30d', '#94a3b8', '#f9a8d4']

type Props = {
  noteColors: string[]
  /** 노트 색으로 더한다. 실패하면 던진다(안내는 부른 쪽이 띄운다). */
  onAdd: (color: string) => Promise<void>
  /** 노트 색을 뺀다. 없으면 빼기 버튼을 보이지 않는다. */
  onRemove?: (color: string) => void
}

/** 새 색 만들기: 색판(채도·명도)·색상 띠·색 코드·추천 색에서 고르고 노트 색으로 더한다. */
export function ColorPicker({ noteColors, onAdd, onRemove }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(RECOMMENDED_COLORS[0]))
  const [text, setText] = useState(RECOMMENDED_COLORS[0])
  const [busy, setBusy] = useState(false)
  const color = normalizeHex(text)
  const full = noteColors.length >= MAX_NOTE_COLORS
  const exists = color !== null && noteColors.includes(color)

  const setFromHsv = (next: Hsv) => {
    setHsv(next)
    setText(hsvToHex(next))
  }
  const setFromText = (value: string) => {
    setText(value)
    const hex = normalizeHex(value)
    if (hex) setHsv(hexToHsv(hex))
  }

  function onPlane(e: PointerEvent<HTMLDivElement>) {
    if (e.type === 'pointermove' && e.buttons === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height))
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
    setFromHsv({ ...hsv, s, v })
  }

  async function add() {
    if (!color || busy) return
    setBusy(true)
    try {
      await onAdd(color)
    } catch {
      // 안내는 부른 쪽이 띄운다. 창은 열어 둔다.
    } finally {
      setBusy(false)
    }
  }

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 })
  return (
    <div className="color-picker">
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
        <svg width="72" height="44" viewBox="0 0 72 44" fill="none" aria-hidden="true">
          <path d="M4 30c10-18 20 10 32-4s20-14 32-2" stroke={color ?? '#c9ccd6'} strokeWidth="5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="tool-pop-caption">추천 색</p>
      <div className="color-chips">
        {RECOMMENDED_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="color-chip"
            aria-label={`추천 색 ${c}`}
            aria-pressed={c === color}
            style={{ background: c, color: c }}
            onClick={() => setFromText(c)}
          />
        ))}
      </div>
      <p className="tool-pop-caption">
        이 노트의 색 · {noteColors.length} / {MAX_NOTE_COLORS}
      </p>
      <div className="color-chips">
        {noteColors.map((c) => (
          <span key={c} className="note-color-chip">
            <button
              type="button"
              className="color-chip"
              aria-label={`노트 색 ${c} 고르기`}
              style={{ background: c, color: c }}
              onClick={() => setFromText(c)}
            />
            {onRemove && (
              <button type="button" className="note-color-remove" aria-label={`노트 색 ${c} 빼기`} onClick={() => onRemove(c)}>
                ×
              </button>
            )}
          </span>
        ))}
        {Array.from({ length: Math.max(0, MAX_NOTE_COLORS - noteColors.length) }, (_, i) => (
          <span key={`empty-${i}`} className="color-chip empty" aria-hidden="true" />
        ))}
      </div>
      <p className="tool-pop-caption">
        {full && !exists
          ? `노트 색은 ${MAX_NOTE_COLORS}개까지예요. 하나를 빼면 더할 수 있어요.`
          : '여기 더한 색은 이 노트에서 함께 쓰는 모두의 도구 막대에 생겨요.'}
      </p>
      <button
        type="button"
        className="btn btn-primary color-add"
        disabled={!color || busy || (full && !exists)}
        onClick={() => void add()}
      >
        이 색 더하기
      </button>
    </div>
  )
}
