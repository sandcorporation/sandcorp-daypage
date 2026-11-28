import * as decoding from 'lib0/decoding'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

/** 서버가 연결을 닫는 이유(consumers.py와 같은 값). */
export const CLOSE = {
  unauthorized: 4401,
  notFound: 4404,
  notToday: 4409,
  crowded: 4429,
  /** 서비스 수용 인원이 찼고 대기열도 가득 참 */
  full: 4430,
  /** 대기자에게 자리를 돌리려고 자리 비움인 사람을 내보냄 */
  away: 4408,
  /** 운영자가 정지한 사용자 */
  suspended: 4403,
  /** 운영자가 닫은 노트 */
  closed: 4410,
  /** 노트를 만든 사람이 내보낸 참여자 */
  kicked: 4411,
} as const

/** 서버 전용 메시지 종류(consumers.py의 MESSAGE_PAGE_ROLLED) */
export const MESSAGE_PAGE_ROLLED = 100
/** 수용 인원이 차 대기열에 섰다: {type: 'queued', position} (consumers.py의 MESSAGE_QUEUED) */
export const MESSAGE_QUEUED = 101
/** 노트 색이 바뀜: {type: 'note_colors', colors} (consumers.py의 MESSAGE_NOTE_COLORS) */
export const MESSAGE_NOTE_COLORS = 102
/** 노트 종이가 바뀜: {type: 'note_paper', paper} (consumers.py의 MESSAGE_NOTE_PAPER) */
export const MESSAGE_NOTE_PAPER = 103
/** 장의 봉인 예정이 바뀜(주인이 봉인 시각을 바꿈): {type: 'note_page', key, dueAt, sealHour} (MESSAGE_NOTE_PAGE) */
export const MESSAGE_NOTE_PAGE = 104

/**
 * 노트 머리말이 바뀜(이름 변경·새 참여·내보내기·다시 허용·정원 변경): {type: 'note_info', name, memberCount, memberLimit, seq}
 * (MESSAGE_NOTE_INFO). 접속해 노트 그룹에 들 때도 한 번 온다. seq는 서버가 읽은 순서대로 커지는 판이다.
 */
export const MESSAGE_NOTE_INFO = 105

/** 받아 쓴 판보다 작거나 같은 머리말 알림은 늦게 도착한 낡은 값이다(#222). 판이 없으면(옛 서버) 받는다. */
export function isNewerInfo(lastSeq: number, seq: number | undefined): boolean {
  return seq === undefined || seq > lastSeq
}

export type NoteInfo = { name: string; memberCount: number; memberLimit: number | null }

export type NotePageChange = { key: string; dueAt: string; sealHour: number }

/** 다시 연결해도 소용없는 이유. full·away는 사람이 다시 시도할 때까지 접속하지 않는다. */
export type FatalReason = 'unauthorized' | 'notFound' | 'crowded' | 'full' | 'away' | 'closed' | 'suspended' | 'kicked'

const FATAL_CODES: Record<number, FatalReason> = {
  [CLOSE.unauthorized]: 'unauthorized',
  [CLOSE.notFound]: 'notFound',
  [CLOSE.crowded]: 'crowded',
  [CLOSE.full]: 'full',
  [CLOSE.away]: 'away',
  [CLOSE.suspended]: 'suspended',
  [CLOSE.closed]: 'closed',
  [CLOSE.kicked]: 'kicked',
}

type Options = {
  noteId: string
  /** 붙을 장의 키(`2026-10-21`, `2026-10-21-2`) */
  pageKey: string
  doc: Y.Doc
  /** 오늘 장이 아니라며 닫혔을 때(자정이 지났거나 봉인됨) */
  onNotToday: () => void
  /** 다시 연결해도 소용없는 이유로 닫혔을 때 */
  onFatal: (reason: FatalReason) => void
  /** 노트 색이 바뀌었을 때(누가 더하거나 뺐다) */
  onNoteColors?: (colors: string[]) => void
  /** 노트 종이가 바뀜(누가 바꿨든) */
  onNotePaper?: (paper: unknown) => void
  /** 장의 봉인 예정 시각이 바뀜(주인이 봉인 시각을 바꿈) */
  onNotePage?: (change: NotePageChange) => void
  /** 노트 이름·참여 수·정원이 바뀜(누가 바꿨든, 누가 들어왔든) */
  onNoteInfo?: (info: NoteInfo) => void
}

/** 장 교체로 다시 붙는 데 이보다 오래 걸리면 지금 연결 상태를 그대로 보인다 */
const SWITCH_GRACE_MS = 10_000

/**
 * 맞춰진 연결에서 이만큼 아무것도 받지 못하면 소켓이 말없이 죽었다고 보고 새로 붙는다(#258). 서버는 보낼 것이
 * 없어도 consumers.KEEPALIVE_EVERY(10초)마다 빈 커서를 보내니, 그 한 번을 놓칠 여유 5초를 더했다. y-websocket은
 * 30초(바꿀 수 없는 상수 messageReconnectTimeout)를 기다려 그동안 칩이 「실시간 연결됨」으로 남는다.
 */
export const SILENT_AFTER_MS = 15_000

export function wsBaseUrl(noteId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/notes/${noteId}/pages`
}

export function useRealtime({ noteId, pageKey, doc, onNotToday, onFatal, onNoteColors, onNotePaper, onNotePage, onNoteInfo }: Options) {
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [synced, setSynced] = useState(false)
  // 대기열 순번(1부터). 대기 중이 아니면 null
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  // 네트워크가 돌아오면 provider를 새로 만든다. 끊겼던 소켓은 닫기 핸드셰이크가 끝나지 않아
  // 기존 provider로는 한참 동안 다시 붙지 못한다.
  const [generation, setGeneration] = useState(0)
  // 새 장으로 바뀌어 일부러 다시 붙는 중(#212). 화면은 이 동안 연결이 끊긴 것으로 보이지 않는다.
  const [switching, setSwitching] = useState(false)
  const switchTimer = useRef<number | undefined>(undefined)
  /** 맞춰진 연결이 있었고 그 뒤로 진짜 끊김이 없었다. 이럴 때만 교체를 조용히 넘긴다. */
  const healthy = useRef(false)
  const connectedKey = useRef(pageKey)
  /** 마지막으로 받아 쓴 머리말의 판. 판은 서버 전체에서 커지므로 다시 연결해도 이어 쓴다. */
  const infoSeq = useRef(0)

  const startSwitch = useCallback(() => {
    if (!healthy.current) return
    setSwitching(true)
    window.clearTimeout(switchTimer.current)
    switchTimer.current = window.setTimeout(() => {
      healthy.current = false
      setSwitching(false)
    }, SWITCH_GRACE_MS)
  }, [])
  const endSwitch = useCallback(() => {
    window.clearTimeout(switchTimer.current)
    switchTimer.current = undefined
    setSwitching(false)
  }, [])
  const loseConnection = useCallback(() => {
    healthy.current = false
    endSwitch()
  }, [endSwitch])
  /** 장이 바뀐 줄 알았는데 새 장을 얻지 못했다: 끊긴 상태를 그대로 보인다 */
  const abandonSwitch = useCallback(() => {
    if (switchTimer.current !== undefined) loseConnection()
  }, [loseConnection])
  useEffect(() => () => window.clearTimeout(switchTimer.current), [])

  useEffect(() => {
    // 같은 브라우저의 다른 탭과 직접 주고받지 않고 항상 서버를 거친다(서버가 봉인·권한을 판단).
    const p = new WebsocketProvider(wsBaseUrl(noteId), pageKey, doc, { disableBc: true, maxBackoffTime: 5000 })
    let everConnected = false
    // 서버가 이 장을 닫겠다고 했다. 뒤따르는 끊김은 장애가 아니다.
    let rolled = false
    const roll = () => {
      rolled = true
      p.shouldConnect = false
      startSwitch()
      onNotToday()
    }
    if (connectedKey.current !== pageKey) {
      connectedKey.current = pageKey
      startSwitch()
    }
    // 자정 교체 알림: 새 날짜의 빈 장으로 옮겨 간다.
    p.messageHandlers[MESSAGE_PAGE_ROLLED] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string; key: string }
      if (msg.type === 'page_rolled') roll()
    }
    // 대기열 순번. 차례가 오면 서버가 같은 연결로 sync를 보내고, sync를 받으면 대기를 거둔다.
    p.messageHandlers[MESSAGE_QUEUED] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string; position: number }
      if (msg.type !== 'queued') return
      loseConnection()
      setQueuePosition(msg.position)
    }
    p.messageHandlers[MESSAGE_NOTE_COLORS] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string; colors: string[] }
      if (msg.type === 'note_colors') onNoteColors?.(msg.colors)
    }
    p.messageHandlers[MESSAGE_NOTE_PAPER] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string; paper: unknown }
      if (msg.type === 'note_paper') onNotePaper?.(msg.paper)
    }
    p.messageHandlers[MESSAGE_NOTE_PAGE] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string } & NotePageChange
      if (msg.type === 'note_page') onNotePage?.({ key: msg.key, dueAt: msg.dueAt, sealHour: msg.sealHour })
    }
    p.messageHandlers[MESSAGE_NOTE_INFO] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string; seq?: number } & NoteInfo
      if (msg.type !== 'note_info' || !isNewerInfo(infoSeq.current, msg.seq)) return
      if (msg.seq !== undefined) infoSeq.current = msg.seq
      onNoteInfo?.({ name: msg.name, memberCount: msg.memberCount, memberLimit: msg.memberLimit })
    }
    setProvider(p)
    setSynced(false)
    setQueuePosition(null)
    setStatus(generation > 0 ? 'reconnecting' : 'connecting')

    const onStatus = ({ status: s }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      if (s === 'connected') {
        everConnected = true
        setStatus('connected')
      } else if (s === 'connecting') {
        setStatus(everConnected ? 'reconnecting' : 'connecting')
      } else {
        if (!rolled) loseConnection()
        setStatus(navigator.onLine ? 'reconnecting' : 'offline')
      }
    }
    const onSync = (isSynced: boolean) => {
      setSynced(isSynced)
      if (!isSynced) return
      healthy.current = true
      endSwitch()
      setQueuePosition(null)
    }
    const onClose = (event: CloseEvent | null) => {
      const code = event?.code
      if (code === CLOSE.notToday) {
        roll()
      } else if (code !== undefined && FATAL_CODES[code]) {
        loseConnection()
        p.shouldConnect = false
        setQueuePosition(null)
        onFatal(FATAL_CODES[code])
      }
    }
    const onOffline = () => {
      loseConnection()
      setStatus('offline')
    }
    const onOnline = () => {
      if (p.shouldConnect) setGeneration((g) => g + 1)
    }

    // 대기열에서는(맞추기 전) 서버가 빈 커서를 보내지 않으니 맞춰진 연결만 본다
    const watchdog = window.setInterval(() => {
      if (p.wsconnected && p.synced && Date.now() - p.wsLastMessageReceived > SILENT_AFTER_MS) {
        loseConnection()
        setGeneration((g) => g + 1)
      }
    }, 1_000)

    p.on('status', onStatus)
    p.on('sync', onSync)
    p.on('connection-close', onClose)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(watchdog)
      p.off('status', onStatus)
      p.off('sync', onSync)
      p.off('connection-close', onClose)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      p.destroy()
      setProvider(null)
    }
    // 콜백은 바뀌어도 다시 연결하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, pageKey, doc, generation])

  /** 지금 provider를 버리고 새로 붙는다 */
  const reconnect = useCallback(() => setGeneration((g) => g + 1), [])

  return { provider, status, synced, queuePosition, reconnect, switching, abandonSwitch }
}
