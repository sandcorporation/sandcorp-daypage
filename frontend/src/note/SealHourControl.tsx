import { useEffect, useRef, useState } from 'react'

type Props = {
  /** 봉인 시각(KST 0~23시) */
  sealHour: number
  /** 만든 사람만 바꾼다. 아니면 아무것도 보이지 않는다(참여자는 카운트다운으로 안다) */
  editable: boolean
  onChange: (hour: number) => Promise<void>
}

export function sealHourLabel(hour: number): string {
  return `봉인 ${String(hour).padStart(2, '0')}:00`
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** 머리글의 봉인 시각. 노트의 하루는 이 시각에 끝난다. 만든 사람이 눌러서 바꾼다. */
export function SealHourControl({ sealHour, editable, onChange }: Props) {
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

  if (!editable) return null

  return (
    <div className="member-control" ref={ref}>
      <button
        type="button"
        className="member-badge member-badge-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {sealHourLabel(sealHour)}
      </button>
      {open && (
        <div className="member-popover" role="dialog" aria-label="봉인 시각">
          <label className="member-limit-row">
            봉인 시각
            <select
              aria-label="봉인 시각"
              value={sealHour}
              onChange={async (e) => {
                await onChange(Number(e.target.value))
                setOpen(false)
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
            이 노트의 하루는 이 시각에 끝나요. 바꾸면 지금 페이지는 다음에 오는 그 시각에 봉인되고, 그 시각이 이미
            지났으면 바로 봉인돼요.
          </p>
        </div>
      )}
    </div>
  )
}
