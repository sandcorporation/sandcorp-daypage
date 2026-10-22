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

/** 같은 날짜의 둘째 장부터 붙는 꼬리: ` (2)` */
export function seqSuffix(seq: number): string {
  return seq > 1 ? ` (${seq})` : ''
}

/** 페이지 키(`2026-10-21`, `2026-10-21-2`)를 (날짜, 순번)으로 */
export function parsePageKey(key: string): { date: string; seq: number } {
  return { date: key.slice(0, 10), seq: key.length > 10 ? Number(key.slice(11)) || 1 : 1 }
}

/** 페이지 키를 `10월 21일 (수) (2)` 형식으로 */
export function formatPageKey(key: string): string {
  const { date, seq } = parsePageKey(key)
  return formatShortDate(date) + seqSuffix(seq)
}

/** `10월 14일 (수)` 형식. */
export function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}월 ${d}일 (${weekday})`
}
