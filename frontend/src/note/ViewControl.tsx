type Props = {
  /** 지금 손가락이 그리지 않고 화면을 옮기는지 */
  fingerMoves: boolean
  onFingerMoves: (on: boolean) => void
  locked: boolean
  onLocked: (on: boolean) => void
}

/**
 * 오른쪽 아래 확대·축소 위의 손가락·화면 고정 버튼(터치 기기에서만 보인다).
 * 손: 한 손가락으로 화면을 옮긴다(펜 전용 모드 켬·끔과 같다). 고정: 손가락·휠로 화면이 움직이거나 확대되지 않는다.
 */
export function ViewControl({ fingerMoves, onFingerMoves, locked, onLocked }: Props) {
  return (
    <div className="view-control" role="group" aria-label="손가락·화면">
      <button
        type="button"
        aria-label="손가락으로 화면 옮기기"
        title={fingerMoves ? '손가락은 화면을 옮겨요 (누르면 손가락으로 그려요)' : '손가락으로 그려요 (누르면 손가락은 화면을 옮겨요)'}
        aria-pressed={fingerMoves}
        onClick={() => onFingerMoves(!fingerMoves)}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M7 10V4.5a1.25 1.25 0 0 1 2.5 0V9M9.5 8.5V3.25a1.25 1.25 0 0 1 2.5 0V9M12 8.75V4.5a1.25 1.25 0 0 1 2.5 0V11c0 3.3-2.2 6-5.25 6-2 0-3.3-1-4.4-2.7L3.2 11.7a1.2 1.2 0 0 1 1.9-1.4L7 12.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="화면 고정"
        title={locked ? '화면이 고정돼 있어요 (누르면 풀어요)' : '화면 고정: 손가락·휠로 화면이 움직이지 않게'}
        aria-pressed={locked}
        onClick={() => onLocked(!locked)}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="4" y="9" width="12" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path
            d={locked ? 'M6.75 9V6.5a3.25 3.25 0 0 1 6.5 0V9' : 'M6.75 9V6.5a3.25 3.25 0 0 1 6.3-1.1'}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
