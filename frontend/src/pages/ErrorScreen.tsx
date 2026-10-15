import { Link } from 'react-router'
import { Brand } from '../components/Brand'
import './invite.css'

const COPY = {
  missing: {
    kicker: '어라?',
    title: '노트를 찾을 수 없어요',
    desc: '링크가 잘못되었거나 노트가 없어요. 받은 링크를 다시 확인해 주세요.',
  },
  crowded: {
    kicker: '잠시만요!',
    title: '지금 너무 많은 사람이 있어요',
    desc: '이 노트에 동시에 들어올 수 있는 인원이 꽉 찼어요. 조금 뒤에 다시 들어와 주세요.',
  },
  server: {
    kicker: '앗!',
    title: '문제가 생겼어요',
    desc: '서버와 이야기하지 못했어요. 잠시 후 새로고침해 주세요.',
  },
} as const

export function ErrorScreen({ kind }: { kind: keyof typeof COPY }) {
  const copy = COPY[kind]
  return (
    <div className="grid-bg invite">
      <header className="invite-header">
        <Brand />
      </header>
      <main className="invite-main">
        <div className="card invite-card" role="alert">
          <p className="hand invite-kicker">{copy.kicker}</p>
          <h1>{copy.title}</h1>
          <p className="invite-desc">{copy.desc}</p>
          <Link to="/" className="btn btn-primary btn-lg invite-cta">
            첫 화면으로
          </Link>
        </div>
      </main>
    </div>
  )
}
