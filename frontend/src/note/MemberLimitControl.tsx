import { useEffect, useRef, useState } from 'react'
import { MemberLimitPicker } from '../components/MemberLimitPicker'

type Props = {
  memberCount: number
  memberLimit: number | null
  editable: boolean
  onChange: (limit: number | null) => Promise<void>
  /** 만든 사람이 노트를 지우려 할 때(확인 창은 부르는 쪽에서) */
  onDelete?: () => void
}

export function memberLabel(count: number, limit: number | null): string {
  return limit === null ? `참여 ${count}명` : `참여 ${count} / ${limit}명`
}

/** 헤더의 정원 표시. 만든 사람은 눌러서 정원을 바꾼다. */
export function MemberLimitControl({ memberCount, memberLimit, editable, onChange, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

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
        <div className="member-popover" role="dialog" aria-label="정원 설정">
          <MemberLimitPicker
            value={memberLimit}
            min={memberCount}
            onChange={async (limit) => {
              await onChange(limit)
              setOpen(false)
            }}
          />
          <p className="member-help">지금 참여자({memberCount}명)보다 적게는 줄일 수 없어요.</p>
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
