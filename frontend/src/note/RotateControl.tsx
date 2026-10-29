import { isIdentityView, type ViewTransform } from '../page/viewTransform'
import { keyHint } from '../page/shortcuts'
import type { Keymap } from '../page/shortcuts'

type Props = {
  view: ViewTransform
  keymap: Keymap
  onRotate: (dir: 1 | -1) => void
  onMirror: () => void
  onReset: () => void
}

const ICON = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true } as const
const STROKE = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/**
 * 오른쪽 아래의 보기 변환 버튼: 반시계(↺)·시계(↻) 방향으로 90도, 좌우 뒤집기, 원위치.
 * 이 탭의 메모리에만 두는 보기 변환이라 문서·다른 참여자에게는 영향이 없다. 돌리거나 뒤집은 동안에는 원위치 버튼이 강조된다.
 */
export function RotateControl({ view, keymap, onRotate, onMirror, onReset }: Props) {
  const changed = !isIdentityView(view)
  return (
    <div className="rotate-control" role="group" aria-label="돌리기·뒤집기" data-changed={changed || undefined}>
      <button type="button" aria-label="반시계 방향으로 돌리기" title={`반시계 방향으로 돌리기${keyHint(keymap, 'rotateCcw')}`} onClick={() => onRotate(-1)}>
        <svg {...ICON}>
          <path d="M4.5 8a6 6 0 1 1-.5 4M4.5 3.5V8H9" {...STROKE} />
        </svg>
      </button>
      <button type="button" aria-label="시계 방향으로 돌리기" title={`시계 방향으로 돌리기${keyHint(keymap, 'rotateCw')}`} onClick={() => onRotate(1)}>
        <svg {...ICON}>
          <path d="M15.5 8a6 6 0 1 0 .5 4M15.5 3.5V8H11" {...STROKE} />
        </svg>
      </button>
      <button
        type="button"
        aria-label="좌우 뒤집기"
        title={`좌우 뒤집기${keyHint(keymap, 'mirror')}`}
        aria-pressed={view.mirror}
        onClick={onMirror}
      >
        <svg {...ICON}>
          <path d="M10 3v14" {...STROKE} strokeDasharray="2 2" />
          <path d="M8 6 3 14h5ZM12 6l5 8h-5Z" {...STROKE} />
        </svg>
      </button>
      <button
        type="button"
        aria-label="돌리기·뒤집기 원위치"
        title={changed ? `원위치${keyHint(keymap, 'viewReset')}` : `원위치 (지금 그대로예요)${keyHint(keymap, 'viewReset')}`}
        aria-pressed={changed}
        onClick={onReset}
      >
        1:1
      </button>
    </div>
  )
}
