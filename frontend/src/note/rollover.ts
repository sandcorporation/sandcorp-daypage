/**
 * 장이 바뀔 때 옛 장 연결이 하는 일(#278). 서버는 교체 알림(100)을 보낸 뒤에도 settings.ROLL_CLOSE_AFTER 동안 옛 장
 * 연결을 열어 두고, 그사이 받은 편집을 지금 장의 같은 자리로 옮기거나 버린 수(106)를 그 연결에 알린다. 그래서
 * 클라이언트도 화면을 새 장으로 바꾼 뒤 옛 연결을 바로 닫지 않고, 서버가 닫을 때까지 늦은 편집을 보내고 106을 받는다.
 *
 * 화면에 보였던 편집은 셋 중 하나가 된다: 앞 장에 남는다 / 새 장의 같은 자리로 간다 / 그 편집을 한 사람에게
 * 「n개는 저장되지 않았어요」를 알린다. 옛 연결이 닫힌 뒤 옛 문서에 한 편집은 보낼 길이 없어 여기서 센다.
 */

export type RollPhase =
  /** 평소: 끊기면 y-websocket이 다시 붙는다 */
  | 'live'
  /** 교체 알림을 받았다. 화면은 아직 옛 장이고 옛 연결은 열려 있다(다시 붙지는 않는다) */
  | 'rolled'
  /** 화면은 새 장으로 바뀌었고 옛 연결은 서버가 닫을 때까지 늦은 편집을 보내고 106을 받는다 */
  | 'draining'
  /** 교체 뒤 옛 연결이 닫혔다. 옛 문서에 한 편집은 보낼 수 없다 */
  | 'closed'
  /** 교체 없이 놓았다(화면을 떠남, 다시 붙기). 같은 문서는 다음 provider가 보낸다 */
  | 'done'

export type RollEvent =
  /** 교체 알림(100) 또는 「오늘 장이 아님」(4409)으로 닫힘을 받았다 */
  | { type: 'rolled' }
  /** 화면이 다른 장(또는 다른 화면)으로 옮겨 이 연결을 놓는다 */
  | { type: 'switched' }
  /** 이 장 문서에 내가 편집했다 */
  | { type: 'edit' }
  /** 서버가 이 연결로 보낸 내 편집 중 count개를 옮기지 못해 버렸다(106) */
  | { type: 'lost'; count: number }
  /** 연결이 닫혔다(서버가 닫았거나 기다릴 만큼 기다렸다) */
  | { type: 'closed' }

export type RollStep = {
  phase: RollPhase
  /** 「n개는 저장되지 않았어요」로 알릴 수(0이면 알리지 않는다) */
  lost: number
  /** provider를 지금 없앤다(연결을 닫고 문서에서 뗀다) */
  destroy: boolean
}

/** 교체 뒤 서버가 옛 연결을 닫지 않아도 이만큼 지나면 클라이언트가 닫는다(서버 ROLL_CLOSE_AFTER 10초 + 여유) */
export const DRAIN_MAX_MS = 15_000

export function rollAfter(phase: RollPhase, event: RollEvent): RollStep {
  const stay = (next: RollPhase = phase): RollStep => ({ phase: next, lost: 0, destroy: false })
  switch (event.type) {
    case 'rolled':
      return phase === 'live' ? stay('rolled') : stay()
    case 'switched':
      // 교체 알림을 받고 연결이 아직 열려 있으면 서버가 닫을 때까지 둔다. 그 밖에는 평소처럼 바로 닫는다.
      if (phase === 'rolled') return stay('draining')
      if (phase === 'draining') return stay()
      if (phase === 'closed') return { phase, lost: 0, destroy: true }
      if (phase === 'done') return stay()
      return { phase: 'done', lost: 0, destroy: true }
    case 'edit':
      // 열린 연결로는 y-websocket이 보낸다(서버가 행선을 정한다). 닫힌 뒤 옛 문서 편집은 보낼 길이 없다.
      return phase === 'closed' ? { phase, lost: 1, destroy: false } : stay()
    case 'lost':
      return { phase, lost: phase === 'done' ? 0 : Math.max(0, event.count), destroy: false }
    case 'closed':
      if (phase === 'draining') return { phase: 'closed', lost: 0, destroy: true }
      // 교체 알림 뒤 화면이 바뀌기 전에 닫혔다: provider는 화면이 바뀔 때 없앤다
      if (phase === 'rolled') return stay('closed')
      return stay()
  }
}
