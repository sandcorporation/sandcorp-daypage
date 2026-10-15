const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export function millisUntil(isoMoment: string, nowMs: number): number {
  return Math.max(0, new Date(isoMoment).getTime() - nowMs)
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/** `YYYY-MM-DD`(KST 날짜)를 `2026. 10. 15 (목)` 형식으로. */
export function formatPageDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${y}. ${m}. ${d} (${weekday})`
}

/** `10월 14일 (수)` 형식. */
export function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}월 ${d}일 (${weekday})`
}
