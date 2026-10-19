import { useState } from 'react'

export type Bar = { label: string; value: number | null; detail?: string }

type Props = {
  title: string
  bars: Bar[]
  /** 축에 이름을 몇 개마다 보일지(막대가 많을 때 겹치지 않게) */
  labelEvery?: number
  height?: number
}

const PAD_TOP = 18
const PAD_BOTTOM = 22

/**
 * 막대 하나짜리 계열의 세로 막대 그래프. 축은 0부터, 막대 끝은 4px 둥글게, 막대 사이 2px 이상 띄운다.
 * 막대에 올리거나 초점을 주면 값이 뜨고, 아래 '표로 보기'로 같은 값을 표로 본다.
 */
export function BarChart({ title, bars, labelEvery = 1, height = 140 }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...bars.map((b) => b.value ?? 0))
  const n = bars.length
  const width = 100 // viewBox 단위(%)
  const slot = width / n
  const barW = Math.max(slot - 2.2, 0.6)
  const plotH = height - PAD_TOP - PAD_BOTTOM
  const shown = hover !== null ? bars[hover] : null

  return (
    <figure className="chart">
      <figcaption className="chart-title">
        <span>{title}</span>
        <span className="chart-readout" aria-live="polite">
          {shown ? `${shown.label} · ${shown.value ?? '—'}${shown.detail ? ` · ${shown.detail}` : ''}` : `최대 ${max}`}
        </span>
      </figcaption>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={title} height={height}>
        <line x1="0" x2={width} y1={PAD_TOP + plotH} y2={PAD_TOP + plotH} className="chart-axis" vectorEffect="non-scaling-stroke" />
        {bars.map((b, i) => {
          const h = b.value ? Math.max((b.value / max) * plotH, 1.5) : 0
          const x = i * slot + (slot - barW) / 2
          const y = PAD_TOP + plotH - h
          return (
            <g
              key={i}
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              {/* 막대보다 넓은 누를 자리 */}
              <rect x={i * slot} y={PAD_TOP} width={slot} height={plotH} className="chart-hit" />
              {h > 0 && <rect x={x} y={y} width={barW} height={h} rx="0.8" className={`chart-bar${hover === i ? ' is-hover' : ''}`} />}
            </g>
          )
        })}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        {bars.map((b, i) => (
          <span key={i}>{i % labelEvery === 0 ? b.label : ''}</span>
        ))}
      </div>
      <details className="chart-table">
        <summary>표로 보기</summary>
        <table>
          <tbody>
            {bars.map((b, i) => (
              <tr key={i}>
                <th scope="row">{b.label}</th>
                <td>{b.value ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
