/**
 * 장이 바뀌는 순간 서버가 새 장으로 옮기지 못해 버린 편집 알림(#268, consumers.py MESSAGE_EDITS_LOST).
 *
 * 버린 수는 교체 알림보다 먼저 온다. 알림 칸이 하나라 따로 띄우면 곧 이어 오는 「새 페이지가 열렸어요」에 덮이므로,
 * 받아 두었다가 그 알림에 붙인다. 교체 알림이 오지 않으면(연결만 닫힘) 받은 즉시 혼자 띄운 것이 남는다.
 */

/** 받은 버린 수를 교체 알림에 붙이는 동안(교체가 그보다 늦게 끝나면 이미 혼자 알린 것으로 친다) */
export const LOST_JOINS_ROLL_FOR_MS = 10_000

export type LostEdits = { count: number; at: number }

export function lostText(count: number): string {
  return `장이 바뀌는 순간 ${count}개는 저장되지 않았어요`
}

/** 버린 수를 더한다. 오래된 것은 새로 센다. */
export function addLost(prev: LostEdits | null, count: number, now: number): LostEdits {
  if (prev && now - prev.at < LOST_JOINS_ROLL_FOR_MS) return { count: prev.count + count, at: now }
  return { count, at: now }
}

/** 아직 떠 있는 알림의 수에 더한다(그 알림이 말하던 수를 잃지 않게 오래됐어도 이어 센다) */
export function addToShown(prev: LostEdits | null, count: number, now: number): LostEdits {
  return { count: (prev?.count ?? 0) + count, at: now }
}

/** 새 페이지 알림 글. 막 받은 버린 수가 있으면 함께 말한다. */
export function rolledText(base: string, lost: LostEdits | null, now: number): string {
  if (!lost || now - lost.at >= LOST_JOINS_ROLL_FOR_MS) return base
  return `${base}. ${lostText(lost.count)}`
}
