const KST = 'Asia/Seoul'

/** '10. 19. 14:05' 처럼 한국 시각으로 짧게 */
export function shortTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

/** '2026-10-19' → '10/19' */
export function dayLabel(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}
