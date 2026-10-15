import * as decoding from 'lib0/decoding'
import { useCallback, useEffect, useState } from 'react'
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
} as const

/** 서버 전용 메시지 종류(consumers.py의 MESSAGE_PAGE_ROLLED) */
export const MESSAGE_PAGE_ROLLED = 100
/** 수용 인원이 차 대기열에 섰다: {type: 'queued', position} (consumers.py의 MESSAGE_QUEUED) */
export const MESSAGE_QUEUED = 101

/** 다시 연결해도 소용없는 이유. full·away는 사람이 다시 시도할 때까지 접속하지 않는다. */
export type FatalReason = 'unauthorized' | 'notFound' | 'crowded' | 'full' | 'away'

const FATAL_CODES: Record<number, FatalReason> = {
  [CLOSE.unauthorized]: 'unauthorized',
  [CLOSE.notFound]: 'notFound',
  [CLOSE.crowded]: 'crowded',
  [CLOSE.full]: 'full',
  [CLOSE.away]: 'away',
}

type Options = {
  noteId: string
  date: string
  doc: Y.Doc
  /** 오늘 장이 아니라며 닫혔을 때(자정이 지났거나 봉인됨) */
  onNotToday: () => void
  /** 다시 연결해도 소용없는 이유로 닫혔을 때 */
  onFatal: (reason: FatalReason) => void
}

export function wsBaseUrl(noteId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/notes/${noteId}/pages`
}

export function useRealtime({ noteId, date, doc, onNotToday, onFatal }: Options) {
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [synced, setSynced] = useState(false)
  // 대기열 순번(1부터). 대기 중이 아니면 null
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  // 네트워크가 돌아오면 provider를 새로 만든다. 끊겼던 소켓은 닫기 핸드셰이크가 끝나지 않아
  // 기존 provider로는 한참 동안 다시 붙지 못한다.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    // 같은 브라우저의 다른 탭과 직접 주고받지 않고 항상 서버를 거친다(서버가 봉인·권한을 판단).
    const p = new WebsocketProvider(wsBaseUrl(noteId), date, doc, { disableBc: true, maxBackoffTime: 5000 })
    let everConnected = false
    // 자정 교체 알림: 새 날짜의 빈 장으로 옮겨 간다.
    p.messageHandlers[MESSAGE_PAGE_ROLLED] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string; date: string }
      if (msg.type === 'page_rolled') {
        p.shouldConnect = false
        onNotToday()
      }
    }
    // 대기열 순번. 차례가 오면 서버가 같은 연결로 sync를 보내고, sync를 받으면 대기를 거둔다.
    p.messageHandlers[MESSAGE_QUEUED] = (_encoder, decoder) => {
      const msg = JSON.parse(decoding.readVarString(decoder)) as { type: string; position: number }
      if (msg.type === 'queued') setQueuePosition(msg.position)
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
        setStatus(navigator.onLine ? 'reconnecting' : 'offline')
      }
    }
    const onSync = (isSynced: boolean) => {
      setSynced(isSynced)
      if (isSynced) setQueuePosition(null)
    }
    const onClose = (event: CloseEvent | null) => {
      const code = event?.code
      if (code === CLOSE.notToday) {
        p.shouldConnect = false
        onNotToday()
      } else if (code !== undefined && FATAL_CODES[code]) {
        p.shouldConnect = false
        setQueuePosition(null)
        onFatal(FATAL_CODES[code])
      }
    }
    const onOffline = () => setStatus('offline')
    const onOnline = () => {
      if (p.shouldConnect) setGeneration((g) => g + 1)
    }

    p.on('status', onStatus)
    p.on('sync', onSync)
    p.on('connection-close', onClose)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
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
  }, [noteId, date, doc, generation])

  /** 지금 provider를 버리고 새로 붙는다 */
  const reconnect = useCallback(() => setGeneration((g) => g + 1), [])

  return { provider, status, synced, queuePosition, reconnect }
}
