import { useId } from 'react'

export const UNLIMITED = 'unlimited'

type Props = {
  value: number | null
  onChange: (value: number | null) => void
  /** 이보다 작은 정원은 고를 수 없다(현재 참여자 수). */
  min?: number
}

const PRESETS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50]

export function MemberLimitPicker({ value, onChange, min = 2 }: Props) {
  const id = useId()
  const floor = Math.max(2, min)
  const options = Array.from(new Set([...PRESETS, ...(value ? [value] : [])]))
    .filter((n) => n >= floor)
    .sort((a, b) => a - b)

  return (
    <label className="field" htmlFor={id}>
      <span>정원 (만든 사람 포함)</span>
      <select
        id={id}
        value={value === null ? UNLIMITED : String(value)}
        onChange={(e) => onChange(e.target.value === UNLIMITED ? null : Number(e.target.value))}
      >
        <option value={UNLIMITED}>무제한</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {n}명
          </option>
        ))}
      </select>
    </label>
  )
}
