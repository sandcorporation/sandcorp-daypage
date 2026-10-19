import type { ConnectionStatus } from './useRealtime'

const LABEL: Record<ConnectionStatus, string> = {
  connecting: '연결하는 중…',
  connected: '실시간 연결됨 · 자동 저장',
  reconnecting: '연결이 끊겼어요 · 다시 연결하는 중…',
  offline: '오프라인 · 다시 연결되면 맞춰져요',
}

/** 휴대폰에서 보이는 짧은 말(아래쪽에 새 소식·건의·배율이 함께 들어가도록) */
const SHORT: Record<ConnectionStatus, string> = {
  connecting: '연결 중…',
  connected: '연결됨',
  reconnecting: '다시 연결 중…',
  offline: '오프라인',
}

type Props = {
  status: ConnectionStatus
  synced: boolean
  /** 서버에 새 버전이 올라왔으면 새로고침을 권한다 */
  newVersion?: boolean
}

/** 긴 말과 짧은 말을 함께 두고 화면 폭에 따라 하나만 보인다(읽어 주기는 늘 긴 말). */
function Label({ long, short }: { long: React.ReactNode; short: string }) {
  return (
    <>
      <span className="pill-long">{long}</span>
      <span className="pill-short" aria-hidden="true">
        {short}
      </span>
    </>
  )
}

export function ConnectionPill({ status, synced, newVersion = false }: Props) {
  const ready = status === 'connected' && synced
  // 쓰던 글은 이미 저장됐으니, 연결이 맞춰진 뒤에만 새로고침을 권한다.
  if (newVersion && ready) {
    return (
      <button type="button" className="connection-pill new-version" onClick={() => window.location.reload()}>
        <span className="status-dot new" aria-hidden="true" />
        <Label long={<>새 버전이 나왔어요 · <strong>새로고침</strong></>} short="새로고침" />
      </button>
    )
  }
  const syncing = status === 'connected' && !synced
  const tone = ready ? '' : status === 'offline' ? ' offline' : ' connecting'
  return (
    <div className="connection-pill" role="status" aria-live="polite">
      <span className={`status-dot${tone}`} aria-hidden="true" />
      <Label long={syncing ? '맞추는 중…' : LABEL[status]} short={syncing ? '맞추는 중…' : SHORT[status]} />
    </div>
  )
}
