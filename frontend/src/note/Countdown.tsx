import { useEffect, useState } from 'react'
import { formatCountdown, millisUntil } from './time'

type Props = {
  nextMidnight: string
  /** 서버 시각 - 브라우저 시각(ms). 브라우저 시계가 틀려도 서버 기준으로 센다. */
  clockOffset: number
}

export function Countdown({ nextMidnight, clockOffset }: Props) {
  const [now, setNow] = useState(() => Date.now() + clockOffset)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 1000)
    return () => window.clearInterval(timer)
  }, [clockOffset])

  return <span className="countdown">새 장까지 {formatCountdown(millisUntil(nextMidnight, now))}</span>
}
