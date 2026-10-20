import { useState } from 'react'
import { clampCustomWidth, CUSTOM_WIDTH_MAX, CUSTOM_WIDTH_MIN, WIDTH_NAMES, type WidthLevel } from './tools'

type Props = {
  widthLevel: WidthLevel
  /** 직접 정한 굵기(px). 없으면 기본 단계를 쓴다 */
  customWidth: number | null
  onWidth: (level: WidthLevel) => void
  /** 없으면 직접 정하기를 보이지 않는다 */
  onCustomWidth?: (px: number) => void
  /** 기본 단계를 고르면 창을 닫는다 */
  onDone: () => void
}

/** 굵기 창: 기본 세 단계와, px로 직접 정하기(밀대·숫자). */
export function WidthPanel({ widthLevel, customWidth, onWidth, onCustomWidth, onDone }: Props) {
  const [text, setText] = useState(String(customWidth ?? 10))
  const apply = (raw: string) => {
    const px = clampCustomWidth(Number(raw))
    if (px === null || !onCustomWidth) return
    setText(String(px))
    onCustomWidth(px)
  }
  const sliderValue = clampCustomWidth(Number(text)) ?? customWidth ?? 10
  return (
    <div className="width-panel">
      <div className="width-options">
        {WIDTH_NAMES.map((name, i) => (
          <button
            key={name}
            type="button"
            className="width-option"
            aria-pressed={customWidth === null && widthLevel === i}
            onClick={() => {
              onWidth(i as WidthLevel)
              onDone()
            }}
          >
            <span className="width-dot" style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
            {name}
          </button>
        ))}
      </div>
      {onCustomWidth && (
        <div className="width-custom" data-active={customWidth !== null}>
          <p className="tool-pop-caption">직접 정하기</p>
          <div className="width-custom-row">
            <input
              type="range"
              aria-label="굵기 밀대"
              min={CUSTOM_WIDTH_MIN}
              max={CUSTOM_WIDTH_MAX}
              value={sliderValue}
              onChange={(e) => apply(e.target.value)}
            />
            <label className="width-px">
              <input
                type="number"
                aria-label="굵기(px)"
                min={CUSTOM_WIDTH_MIN}
                max={CUSTOM_WIDTH_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={(e) => apply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply(e.currentTarget.value)
                }}
              />
              px
            </label>
          </div>
          <span className="width-preview" aria-hidden="true">
            <span style={{ height: Math.min(sliderValue, 24) }} />
          </span>
        </div>
      )}
    </div>
  )
}
