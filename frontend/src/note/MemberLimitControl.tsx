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
  /** 있으면 만든 사람에게 참여자 목록(내보내기·다시 허용)을 보인다. onNotice는 그 결과를 알리는 자리 */
  members?: { noteId: string; onNotice: (text: string) => void }
}

export function memberLabel(count: number, limit: number | null): string {
  return limit === null ? `참여 ${count}명` : `참여 ${count} / ${limit}명`
}

/** 헤더의 정원 표시. 만든 사람은 눌러서 정원을 바꾼다.
 * 키보드 화살표는 한 칸마다 값을 바꾸므로, 고르는 것만으로는 저장하지 않고 저장 단추나 Enter로 바꾼다. */
export function MemberLimitControl({ memberCount, memberLimit, editable, onChange, onDelete, members }: Props) {
  const [open, setOpen] = useState(false)
  // 고르고 아직 저장하지 않은 값. undefined면 지금 정원을 보인다(null은 무제한)
  const [picked, setPicked] = useState<number | null | undefined>(undefined)
  const ref = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)

  const close = useCallback(() => setOpen(false), [])
  // 초점이 이 창 안(또는 갈 곳 없는 body)에 있을 때만 단추로 돌린다. 그사이 다른 곳을 잡았으면 뺏지 않는다.
  const closeAndRefocus = useCallback(() => {
    const active = document.activeElement
    if (active === document.body || ref.current?.contains(active)) badgeRef.current?.focus()
    setOpen(false)
  }, [])
  useDismiss(ref, open, close, closeAndRefocus)

  const label = memberLabel(memberCount, memberLimit)
  if (!editable) return <span className="member-badge">{label}</span>

  // 고른 사이에 참여자가 늘어 고를 수 없게 된 값은 버린다
  const draft = picked === undefined || (picked !== null && picked < memberCount) ? memberLimit : picked

  const save = async () => {
    if (savingRef.current) return
    if (draft !== memberLimit) {
      savingRef.current = true
      try {
        await onChange(draft)
      } finally {
        savingRef.current = false
      }
    }
    closeAndRefocus()
  }

  return (
    <div className="member-control" ref={ref}>
      <button
        ref={badgeRef}
        type="button"
        className="member-badge member-badge-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (!open) setPicked(undefined)
          setOpen(!open)
        }}
      >
        {label}
      </button>
      {open && (
        <div className="member-popover" role="dialog" aria-label="참여자와 정원">
          <MemberLimitPicker
            value={draft}
            min={memberCount}
            onChange={setPicked}
            onSubmit={() => void save()}
          />
          <p className="member-help">지금 참여자({memberCount}명)보다 적게는 줄일 수 없어요.</p>
          <button type="button" className="btn btn-primary member-save" onClick={() => void save()}>
            저장
          </button>
          {members && <MemberList {...members} memberCount={memberCount} />}
          {onDelete && (
            <button
              type="button"
              className="member-delete"
              onClick={() => {
                // 이 단추는 사라지므로, 확인 창이 닫힐 때 돌려줄 자리로 먼저 옮긴다
                badgeRef.current?.focus()
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
