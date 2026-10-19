export type Zoom = 'fit' | number

const STEPS = [0.35, 0.5, 0.75, 1, 1.5, 2]

/** 다음 배율. 맞춤 배율에서 출발해 정해진 단계로 오르내린다. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return STEPS.find((s) => s > current + 0.001) ?? STEPS[STEPS.length - 1]
  return [...STEPS].reverse().find((s) => s < current - 0.001) ?? STEPS[0]
}

type Props = { scale: number; zoom: Zoom; onZoom: (zoom: Zoom) => void }

export function ZoomControl({ scale, zoom, onZoom }: Props) {
  return (
    <div className="zoom-control" role="group" aria-label="확대·축소">
      <button type="button" aria-label="축소" onClick={() => onZoom(stepZoom(scale, -1))} disabled={scale <= STEPS[0]}>
        −
      </button>
      <button type="button" aria-label="화면에 맞추기" aria-pressed={zoom === 'fit'} onClick={() => onZoom('fit')}>
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        aria-label="확대"
        onClick={() => onZoom(stepZoom(scale, 1))}
        disabled={scale >= STEPS[STEPS.length - 1]}
      >
        +
      </button>
    </div>
  )
}
