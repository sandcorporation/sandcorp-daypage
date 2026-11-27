import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useDismiss } from '../components/useDismiss'
import { sealsImmediately } from './time'

type Props = {
  /** 봉인 시각(KST 0~23시) */
  sealHour: number
  /** 지금 장이 열린 시각(ISO). 바꾸면 바로 보관되는지 판단한다 */
  openedAt: string
  /** 서버 시각 - 이 기기 시각(ms) */
  clockOffset: number
  /** 만든 사람만 바꾼다. 아니면 아무것도 보이지 않는다(참여자는 카운트다운으로 안다) */
  editable: boolean
  onChange: (hour: number) => Promise<void>
}

export function sealHourLabel(hour: number): string {
  return `새 페이지 ${String(hour).padStart(2, '0')}:00`
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** 머리글의 봉인 시각(화면에는 '새 페이지 HH:00'). 노트의 하루는 이 시각에 끝난다. 만든 사람이 눌러서 바꾼다.
 * 지금 장을 바로 보관할 수 있어(되돌릴 수 없음) 고르는 것만으로는 바꾸지 않고, 저장 단추나 Enter로 바꾼다. */
export function SealHourControl({ sealHour, openedAt, clockOffset, editable, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(sealHour)
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)
  const warningId = useId()

  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  // 창을 열어 둔 사이에 고른 시각이 지나면 경고가 따라 나타난다
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])

  if (!editable) return null

  const archivesAt = (at: number) => draft !== sealHour && sealsImmediately(openedAt, draft, at + clockOffset)
  const warns = archivesAt(now)

  const toggle = () => {
    if (!open) {
      setDraft(sealHour)
      setNow(Date.now())
    }
    setOpen(!open)
  }

  // 초점이 이 창 안(또는 갈 곳 없는 body)에 있을 때만 단추로 돌린다. 그사이 다른 곳을 잡았으면 뺏지 않는다.
  const closeAndRefocus = () => {
    const active = document.activeElement
    if (active === document.body || ref.current?.contains(active)) triggerRef.current?.focus()
    setOpen(false)
  }

  const save = async () => {
    if (savingRef.current) return
    if (draft === sealHour) return closeAndRefocus()
    const at = Date.now()
    // 경고를 아직 못 본 채로는 보관하지 않는다: 먼저 보여 주고 한 번 더 확인받는다
    if (!warns && archivesAt(at)) return setNow(at)
    savingRef.current = true
    try {
      await onChange(draft)
    } finally {
      savingRef.current = false
    }
    closeAndRefocus()
  }

  return (
    <div
      className="member-control"
      ref={ref}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') closeAndRefocus()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="member-badge member-badge-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        {sealHourLabel(sealHour)}
      </button>
      {open && (
        <div className="member-popover" role="dialog" aria-label="새 페이지 시각">
          <label className="member-limit-row">
            새 페이지가 열리는 시각
            <select
              aria-label="새 페이지 시각"
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                void save()
              }}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <p className="member-help">
            매일 이 시각에 새 페이지가 열리고, 쓰던 페이지는 기록에 보관돼요. 바꾸면 지금 페이지는 다음에 오는 그
            시각에 보관되고, 그 시각이 이미 지났으면 바로 보관돼요.
          </p>
          <p id={warningId} className="member-warning" role="status">
            {warns && '저장하면 지금 페이지가 바로 기록에 보관돼요. 되돌릴 수 없어요.'}
          </p>
          <button
            type="button"
            className="btn btn-primary member-save"
            aria-describedby={warningId}
            onClick={() => void save()}
          >
            저장
          </button>
        </div>
      )}
    </div>
  )
}
