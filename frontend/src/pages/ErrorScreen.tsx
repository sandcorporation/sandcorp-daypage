import { PRIVACY_LABEL, PRIVACY_URL } from '../privacyLink'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Brand } from '../components/Brand'
import './invite.css'

const COPY = {
  missing: {
    kicker: '어라?',
    title: '노트를 찾을 수 없어요',
    desc: '링크가 잘못되었거나, 만든 사람이 노트를 지웠어요. 받은 링크를 다시 확인해 주세요.',
  },
  crowded: {
    kicker: '잠시만요!',
    title: '지금 너무 많은 사람이 있어요',
    desc: '이 노트에 동시에 들어올 수 있는 인원이 꽉 찼어요. 조금 뒤에 다시 들어와 주세요.',
  },
  full: {
    kicker: '잠시만요!',
    title: '지금은 사람이 너무 많아요',
    desc: 'Daypage에 들어올 수 있는 인원도, 기다리는 줄도 가득 찼어요. 잠시 후 다시 시도해 주세요.',
    action: '다시 시도',
  },
  away: {
    kicker: '어디 가셨어요?',
    title: '자리를 비워 나갔어요',
    desc: '기다리는 사람이 있어서, 한동안 움직임이 없던 자리를 넘겨 드렸어요. 쓰던 노트는 그대로 있어요.',
    action: '다시 들어가기',
  },
  closed: {
    kicker: '잠시만요',
    title: '닫힌 노트예요',
    desc: '운영 정책에 따라 이 노트는 닫혔어요.',
  },
  suspended: {
    kicker: '잠시만요',
    title: '이용이 정지된 계정이에요',
    desc: '정지가 끝나면 다시 노트를 쓸 수 있어요.',
  },
  kicked: {
    kicker: '잠시만요',
    title: '이 노트에 들어갈 수 없어요',
    desc: '노트를 만든 사람이 이 노트에서 내보냈어요.',
  },
  server: {
    kicker: '앗!',
    title: '문제가 생겼어요',
    desc: '서버와 이야기하지 못했어요. 잠시 후 새로고침해 주세요.',
  },
} as const

type Props = {
  kind: keyof typeof COPY
  /** 있으면 '첫 화면으로' 대신 이 동작(다시 시도·다시 들어가기)을 주 버튼으로 보인다 */
  onAction?: () => void
  /** 있으면 설명 대신 보인다(서버가 알려 준 사유 등) */
  detail?: string
}

/** 운영 조치로 막힌 까닭(서버 code → 화면 종류) */
export const BLOCKED_KINDS = { note_closed: 'closed', suspended: 'suspended', kicked: 'kicked' } as const
export type BlockedKind = (typeof BLOCKED_KINDS)[keyof typeof BLOCKED_KINDS]

export function blockedKind(code: string | undefined): BlockedKind | null {
  return code && code in BLOCKED_KINDS ? BLOCKED_KINDS[code as keyof typeof BLOCKED_KINDS] : null
}

export function ErrorScreen({ kind, onAction, detail }: Props) {
  const copy: { kicker: string; title: string; desc: string; action?: string } = COPY[kind]
  return (
    <MessageCard kicker={copy.kicker} title={copy.title} desc={detail || copy.desc}>
      {onAction && copy.action ? (
        <button type="button" className="btn btn-primary btn-lg invite-cta" onClick={onAction}>
          {copy.action}
        </button>
      ) : (
        <Link to="/" className="btn btn-primary btn-lg invite-cta">
          첫 화면으로
        </Link>
      )}
    </MessageCard>
  )
}

/** 오류·대기 화면이 함께 쓰는 가운데 카드 */
export function MessageCard({
  kicker,
  title,
  desc,
  role = 'alert',
  children,
}: {
  kicker: string
  title: string
  desc: ReactNode
  role?: 'alert' | 'status'
  children?: ReactNode
}) {
  return (
    <div className="grid-bg invite">
      <header className="invite-header">
        <Brand />
      </header>
      <main className="invite-main">
        <div className="card invite-card" role={role}>
          <p className="hand invite-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="invite-desc">{desc}</p>
          {children}
          <p className="invite-foot">
            <a href={PRIVACY_URL} target="_blank" rel="noopener">
              {PRIVACY_LABEL}
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
