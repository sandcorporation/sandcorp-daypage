import type { ReactNode } from 'react'
import { BRUSHES, type Brush } from './tools'

const WAVE = 'M10 26c24-18 44 14 70 0s44-18 66-2'

/** 펜 종류마다 미리보기 획(대략적인 모양) */
const PREVIEW: Record<Brush, ReactNode> = {
  ballpoint: <path d={WAVE} stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" fill="none" />,
  fountain: <path d="M10 28c22-20 44 12 70-2s44-18 66-4c-22-6-44 10-66 8s-46-18-70 2z" fill="currentColor" />,
  pencil: (
    <path d={WAVE} stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeDasharray="1.5 1" fill="none" opacity="0.75" />
  ),
  brushpen: (
    <path d="M8 30c16-4 30-20 52-10s40 12 58 0 22-8 28-6c-6 6-20 18-40 16s-34-14-54-6-30 10-44 6z" fill="currentColor" />
  ),
  crayon: <path d={WAVE} stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeDasharray="2 1.5" fill="none" opacity="0.85" />,
}

type Props = {
  brush: Brush
  onBrush: (brush: Brush) => void
  /** 펜 종류 목록 아래에 붙는 설정(필압 등) */
  children?: ReactNode
}

export function BrushPicker({ brush, onBrush, children }: Props) {
  return (
    <>
      <p className="tool-pop-caption">펜을 한 번 더 누르면 열려요</p>
      <div className="brush-list">
        {BRUSHES.map((b) => (
          <button
            key={b.id}
            type="button"
            className="brush-option"
            aria-pressed={b.id === brush}
            aria-label={`${b.name}: ${b.desc}`}
            onClick={() => onBrush(b.id)}
          >
            <svg width="156" height="44" viewBox="0 0 156 44" aria-hidden="true">
              {PREVIEW[b.id]}
            </svg>
            <span className="brush-text">
              <span className="brush-name">{b.name}</span>
              <span className="brush-desc">{b.desc}</span>
            </span>
          </button>
        ))}
      </div>
      {children}
    </>
  )
}
