/**
 * 고른 것이 있을 때만 보기 칸에 뜨는 지우기 단추(#262). Delete 키가 없는 화면(전자칠판·태블릿·폰)과
 * 키를 모르는 마우스 사용자의 길이라, 터치 전용인 ViewControl과 달리 어느 기기에서나 보인다.
 */
export function DeleteSelectedButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button type="button" className="delete-selected" aria-label="고른 것 지우기" title="고른 것 지우기" onClick={onDelete}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3.5 5.5h13M8 5.25V3.5h4v1.75M5.25 5.5l.75 11h8l.75-11M8.25 8.5v5M11.75 8.5v5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>지우기</span>
    </button>
  )
}
