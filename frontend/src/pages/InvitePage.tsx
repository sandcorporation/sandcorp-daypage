import { Brand, KakaoIcon, kakaoLoginHref } from '../components/Brand'
import './invite.css'

type Props = {
  noteId: string
  noteName: string | null
  online: number
  isFull: boolean
  /** 로그인은 했지만 정원이 차서 들어오지 못한 경우 */
  loggedIn?: boolean
}

export function InvitePage({ noteId, noteName, online, isFull, loggedIn = false }: Props) {
  const title = noteName ?? '노트'
  return (
    <div className="grid-bg invite">
      <header className="invite-header">
        <Brand />
      </header>
      <main className="invite-main">
        <div className="card invite-card">
          <p className="hand invite-kicker">{isFull ? '아쉬워요!' : '같이 그려요!'}</p>
          <h1>
            ‘{title}’에
            <br />
            초대받았어요
          </h1>
          {isFull ? (
            <p className="invite-desc">
              이 노트는 <b>정원이 찼어요.</b>
              <br />
              만든 사람이 정원을 늘리면 들어올 수 있어요.
            </p>
          ) : (
            <p className="invite-desc">
              {online > 0 ? `지금 ${online}명이 오늘 페이지를 채우고 있어요.` : '오늘 페이지가 기다리고 있어요.'}
              <br />
              카카오로 로그인하면 바로 함께 그릴 수 있어요.
            </p>
          )}

          <div className="invite-preview" aria-hidden="true">
            <svg width="100%" height="120" viewBox="0 0 380 120" preserveAspectRatio="xMidYMid meet" fill="none">
              <path d="M40 70c20-30 40 10 60-5s40-20 60 5" stroke="var(--orange)" strokeWidth="3" strokeLinecap="round" />
              <path
                d="M220 30c30-18 90-12 100 20s-30 50-60 40-60-40-40-60z"
                stroke="var(--accent)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span>미리보기는 흐리게 보여요</span>
          </div>

          {isFull ? (
            <div className="invite-full" role="status">
              정원이 찼어요
            </div>
          ) : loggedIn ? null : (
            <a className="btn btn-kakao btn-lg invite-cta" href={kakaoLoginHref(`/note/${noteId}`)}>
              <KakaoIcon size={22} />
              카카오로 로그인하고 참여하기
            </a>
          )}
          <p className="invite-foot">
            들어가면 랜덤 닉네임(예: 푸른 펭귄)으로 표시돼요.
            <br />
            카카오 프로필 이름은 공개되지 않아요.
          </p>
        </div>
      </main>
    </div>
  )
}
