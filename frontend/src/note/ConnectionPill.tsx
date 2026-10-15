import type { ConnectionStatus } from './useRealtime'

const LABEL: Record<ConnectionStatus, string> = {
  connecting: '연결하는 중…',
  connected: '실시간 연결됨 · 자동 저장',
  reconnecting: '연결이 끊겼어요 · 다시 연결하는 중…',
  offline: '오프라인 · 다시 연결되면 맞춰져요',
}

export function ConnectionPill({ status, synced }: { status: ConnectionStatus; synced: boolean }) {
  const label = status === 'connected' && !synced ? '맞추는 중…' : LABEL[status]
  const tone = status === 'connected' && synced ? '' : status === 'offline' ? ' offline' : ' connecting'
  return (
    <div className="connection-pill" role="status" aria-live="polite">
      <span className={`status-dot${tone}`} aria-hidden="true" />
      {label}
    </div>
  )
}
