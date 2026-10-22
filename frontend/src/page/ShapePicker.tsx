import { SHAPE_FILL_NAMES, SHAPE_FILLS, SHAPES, type ShapeFill, type ShapeKind } from './shapes'

type Props = {
  shape: ShapeKind
  onShape: (shape: ShapeKind) => void
  /** 닫힌 도형의 채움(0이면 테두리만). 없으면 채움 선택을 보이지 않는다 */
  fill?: ShapeFill
  onFill?: (fill: ShapeFill) => void
}

/** 도형 고르기(펜 종류 고르기와 같은 모양). 도형은 지금 펜 종류·색·굵기로 그려진다. */
export function ShapePicker({ shape, onShape, fill, onFill }: Props) {
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
      {onFill && (
        <div className="shape-fill" role="group" aria-label="채움">
          <p className="tool-pop-caption">채움 · 사각형·원·삼각형과 첫 점으로 닫은 곡선의 안을 색으로 채워요</p>
          <div className="width-options">
            {SHAPE_FILL_NAMES.map((name, i) => (
              <button
                key={name}
                type="button"
                className="width-option"
                aria-pressed={(fill ?? 0) === SHAPE_FILLS[i]}
                onClick={() => onFill(SHAPE_FILLS[i])}
              >
                <span className="width-dot" style={{ width: 14, height: 14, opacity: SHAPE_FILLS[i] || 0.08 }} />
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
