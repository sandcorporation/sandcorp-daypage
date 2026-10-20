import { useState } from 'react'
import { MAX_NOTE_COLORS, RECOMMENDED_COLORS } from './color'
import { ColorField, useColorField } from './ColorField'

type Props = {
  noteColors: string[]
  /** 노트 색으로 더한다. 실패하면 던진다(안내는 부른 쪽이 띄운다). */
  onAdd: (color: string) => Promise<void>
  /** 노트 색을 뺀다. 없으면 빼기 버튼을 보이지 않는다. */
  onRemove?: (color: string) => void
}

/** 새 색 만들기: 색판(채도·명도)·색상 띠·색 코드·추천 색에서 고르고 노트 색으로 더한다. */
export function ColorPicker({ noteColors, onAdd, onRemove }: Props) {
  const field = useColorField(RECOMMENDED_COLORS[0])
  const { color, setFromText } = field
  const [busy, setBusy] = useState(false)
  const full = noteColors.length >= MAX_NOTE_COLORS
  const exists = color !== null && noteColors.includes(color)

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

  return (
    <div className="color-picker">
      <ColorField
        field={field}
        sample={
          <svg width="72" height="44" viewBox="0 0 72 44" fill="none" aria-hidden="true">
            <path d="M4 30c10-18 20 10 32-4s20-14 32-2" stroke={color ?? '#c9ccd6'} strokeWidth="5" strokeLinecap="round" />
          </svg>
        }
      />
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
