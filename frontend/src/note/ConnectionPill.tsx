import type { ConnectionStatus } from './useRealtime'

const LABEL: Record<ConnectionStatus, string> = {
  connecting: '연결하는 중…',
  connected: '실시간 연결됨 · 자동 저장',
  reconnecting: '연결이 끊겼어요 · 다시 연결하는 중…',
  offline: '오프라인 · 다시 연결되면 맞춰져요',
}

type Props = {
  status: ConnectionStatus
  synced: boolean
  /** 서버에 새 버전이 올라왔으면 새로고침을 권한다 */
  newVersion?: boolean
}

export function ConnectionPill({ status, synced, newVersion = false }: Props) {
  const ready = status === 'connected' && synced
  // 쓰던 글은 이미 저장됐으니, 연결이 맞춰진 뒤에만 새로고침을 권한다.
  if (newVersion && ready) {
    return (
      <button type="button" className="connection-pill new-version" onClick={() => window.location.reload()}>
        <span className="status-dot new" aria-hidden="true" />
        새 버전이 나왔어요 · <strong>새로고침</strong>
      </button>
    )
  }
  const label = status === 'connected' && !synced ? '맞추는 중…' : LABEL[status]
  const tone = ready ? '' : status === 'offline' ? ' offline' : ' connecting'
  return (
    <div className="connection-pill" role="status" aria-live="polite">
      <span className={`status-dot${tone}`} aria-hidden="true" />
      {label}
    </div>
  )
}
