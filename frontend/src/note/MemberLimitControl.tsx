import { useCallback, useRef, useState } from 'react'
import { useDismiss } from '../components/useDismiss'
import { MemberLimitPicker } from '../components/MemberLimitPicker'
import { MemberList } from './MemberList'

type Props = {
  memberCount: number
  memberLimit: number | null
  editable: boolean
  onChange: (limit: number | null) => Promise<void>
  /** 만든 사람이 노트를 지우려 할 때(확인 창은 부르는 쪽에서) */
  onDelete?: () => void
  /** 있으면 만든 사람에게 참여자 목록(내보내기·다시 허용)을 보인다 */
  noteId?: string
}

export function memberLabel(count: number, limit: number | null): string {
  return limit === null ? `참여 ${count}명` : `참여 ${count} / ${limit}명`
}

/** 헤더의 정원 표시. 만든 사람은 눌러서 정원을 바꾼다. */
export function MemberLimitControl({ memberCount, memberLimit, editable, onChange, onDelete, noteId }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  const label = memberLabel(memberCount, memberLimit)
  if (!editable) return <span className="member-badge">{label}</span>

  return (
    <div className="member-control" ref={ref}>
      <button
        type="button"
        className="member-badge member-badge-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className="member-popover" role="dialog" aria-label="참여자와 정원">
          <MemberLimitPicker
            value={memberLimit}
            min={memberCount}
            onChange={async (limit) => {
              await onChange(limit)
              setOpen(false)
            }}
          />
          <p className="member-help">지금 참여자({memberCount}명)보다 적게는 줄일 수 없어요.</p>
          {noteId && <MemberList noteId={noteId} />}
          {onDelete && (
            <button
              type="button"
              className="member-delete"
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
            >
              이 노트 삭제
            </button>
          )}
        </div>
      )}
    </div>
  )
}
