import { SHAPES, type ShapeKind } from './shapes'

type Props = {
  shape: ShapeKind
  onShape: (shape: ShapeKind) => void
}

/** 도형 고르기(펜 종류 고르기와 같은 모양). 도형은 지금 펜 종류·색·굵기로 그려진다. */
export function ShapePicker({ shape, onShape }: Props) {
  return (
    <>
      <p className="tool-pop-caption">도형을 한 번 더 누르면 열려요 · 지금 펜 종류·색·굵기로 그려요</p>
      <div className="brush-list">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            type="button"
            className="brush-option shape-option"
            aria-pressed={s.id === shape}
            aria-label={`${s.name}: ${s.desc}`}
            onClick={() => onShape(s.id)}
          >
            <svg width="44" height="44" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d={s.icon} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <span className="brush-text">
              <span className="brush-name">{s.name}</span>
              <span className="brush-desc">{s.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
