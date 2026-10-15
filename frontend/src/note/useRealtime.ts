import * as decoding from 'lib0/decoding'
import { useEffect, useState } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

/** 서버가 연결을 닫는 이유(consumers.py와 같은 값). */
export const CLOSE = {
  unauthorized: 4401,
  notFound: 4404,
  notToday: 4409,
  crowded: 4429,
} as const

/** 서버 전용 메시지 종류(consumers.py의 MESSAGE_PAGE_ROLLED) */
export const MESSAGE_PAGE_ROLLED = 100

export type FatalReason = 'unauthorized' | 'notFound' | 'crowded'

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
    setProvider(p)
    setSynced(false)
    setStatus('connecting')

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
    const onSync = (isSynced: boolean) => setSynced(isSynced)
    const onClose = (event: CloseEvent | null) => {
      const code = event?.code
      if (code === CLOSE.notToday) {
        p.shouldConnect = false
        onNotToday()
      } else if (code === CLOSE.unauthorized || code === CLOSE.notFound || code === CLOSE.crowded) {
        p.shouldConnect = false
        onFatal(code === CLOSE.unauthorized ? 'unauthorized' : code === CLOSE.notFound ? 'notFound' : 'crowded')
      }
    }
    const onOffline = () => setStatus('offline')
    const onOnline = () => setStatus('reconnecting')

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
  }, [noteId, date, doc])

  return { provider, status, synced }
}
