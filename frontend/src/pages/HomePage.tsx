import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import { logout, useMe, type MyNote } from '../auth/me'
import { Brand, KakaoIcon, kakaoLoginHref } from '../components/Brand'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MemberLimitPicker } from '../components/MemberLimitPicker'
import './home.css'

export function HomePage() {
  const { me, reload } = useMe()
  if (!me) return <div className="grid-bg" />
  return me.authenticated ? <MyNotes notes={me.notes} onChanged={reload} /> : <Landing />
}

function Landing() {
  return (
    <div className="grid-bg">
      <header className="home-header">
        <Brand />
        <nav className="home-nav">
          <a href="#how" className="home-nav-link">
            이용 방법
          </a>
          <a className="btn btn-kakao" href={kakaoLoginHref('/')}>
            <KakaoIcon size={18} />
            카카오 로그인
          </a>
        </nav>
      </header>

      <main className="landing">
        <section className="landing-copy">
          <p className="hand landing-kicker">오늘도 한 장, 같이 채워요</p>
          <h1>
            링크 하나로 열리는
            <br />
            함께 쓰는 하루 노트
          </h1>
          <p className="landing-desc">
            그리고, 쓰고, 지우고. 링크를 받은 사람은 누구나 같은 장에 실시간으로 그릴 수 있어요. 밤 12시가 되면
            새 장이 펼쳐지고, 지난 장은 기록에 고이 남습니다.
          </p>
          <div className="landing-cta">
            <a className="btn btn-kakao btn-lg" href={kakaoLoginHref('/')}>
              <KakaoIcon size={22} />
              카카오로 시작하기
            </a>
          </div>
          <p className="landing-note">
            로그인하면 ‘졸린 수달’ 같은 랜덤 닉네임이 붙어요. 카카오 프로필 이름은 다른 사람에게 보이지 않아요.
          </p>
        </section>

        <section className="landing-art" aria-hidden="true">
          <div className="landing-sheet">
            <div className="landing-sheet-top">
              <span>오늘의 장</span>
              <span className="landing-live">
                <span className="dot" />
                3명 함께 쓰는 중
              </span>
            </div>
            <div className="landing-sheet-body">
              <p className="hand landing-sheet-title">오늘 할 일</p>
              <p className="hand landing-sheet-list">
                - 회의록 정리
                <br />- 장 보기 (우유, 계란)
                <br />- 6시 운동!!
              </p>
              <svg width="100%" height="340" viewBox="0 0 440 340" fill="none">
                <path d="M120 103c30 -6 60 -4 92 2" stroke="var(--yellow)" strokeWidth="16" strokeLinecap="round" opacity="0.55" />
                <path d="M260 60c40-30 110-20 120 30s-50 80-90 60-60-60-30-90z" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
                <path d="M300 95l14 14 26-30" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M60 250c20-30 40 20 60-5s40-25 60 5 40 15 60-10" stroke="var(--orange)" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="landing-cursor" style={{ left: 330, top: 196, background: 'var(--orange)' }}>
                용감한 고구마
              </span>
              <span className="landing-cursor" style={{ left: 150, top: 280, background: 'var(--accent)' }}>
                졸린 수달
              </span>
            </div>
          </div>
          <div className="hand landing-sticker">자정에 새 장!</div>
        </section>
      </main>

      <section id="how" className="how">
        {[
          ['노트를 만들고', '카카오로 로그인하고 버튼 한 번이면 나만의 긴 링크가 생겨요.'],
          ['링크를 건네면', '받은 사람도 로그인만 하면 같은 장에서 동시에 그리고 쓸 수 있어요.'],
          ['자정마다 새 장으로', '지난 장은 기록에서 언제든 볼 수 있지만, 고칠 수는 없어요.'],
        ].map(([title, desc], i) => (
          <div key={title} className="how-card">
            <p className="hand how-num">{i + 1}</p>
            <h2>{title}</h2>
            <p>{desc}</p>
          </div>
        ))}
      </section>
    </div>
  )
}

function MyNotes({ notes, onChanged }: { notes: MyNote[]; onChanged: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [memberLimit, setMemberLimit] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<MyNote | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await api<void>(`/api/notes/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      onChanged()
    } catch {
      setError('노트를 지우지 못했어요. 잠시 후 다시 시도해 주세요.')
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const note = await api<{ id: string }>('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ name, memberLimit }),
      })
      navigate(`/note/${note.id}`)
    } catch {
      setError('노트를 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
      setCreating(false)
    }
  }

  async function doLogout() {
    await logout()
    onChanged()
  }

  return (
    <div className="grid-bg">
      <header className="home-header">
        <Brand />
        <button type="button" className="btn" onClick={doLogout}>
          로그아웃
        </button>
      </header>
      <main className="mynotes">
        <form className="card new-note" onSubmit={create}>
          <p className="hand new-note-kicker">새 장을 펼쳐요</p>
          <h1>새 노트 만들기</h1>
          <label className="field">
            <span>노트 이름</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름 없는 노트"
              maxLength={60}
            />
          </label>
          <MemberLimitPicker value={memberLimit} onChange={setMemberLimit} />
          <button type="submit" className="btn btn-primary btn-lg" disabled={creating}>
            {creating ? '만드는 중…' : '노트 만들기'}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>

        <section className="note-list" aria-labelledby="my-notes-title">
          <h2 id="my-notes-title">내 노트</h2>
          {notes.length === 0 ? (
            <p className="empty">아직 노트가 없어요. 새 노트를 만들거나 받은 링크로 들어가 보세요.</p>
          ) : (
            <ul>
              {notes.map((n) => (
                <li key={n.id} className="note-item">
                  <Link to={`/note/${n.id}`} className="note-card">
                    <span className="note-card-thumb" aria-hidden="true" />
                    <span className="note-card-body">
                      <span className="note-card-name">{n.name}</span>
                      <span className="note-card-meta">
                        참여 {n.memberCount}
                        {n.memberLimit ? ` / ${n.memberLimit}` : ''}명{n.isOwner ? ' · 내가 만듦' : ''}
                      </span>
                    </span>
                  </Link>
                  {n.isOwner && (
                    <button
                      type="button"
                      className="note-delete"
                      aria-label={`노트 삭제: ${n.name}`}
                      title="노트 삭제"
                      onClick={() => setDeleting(n)}
                    >
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      {deleting && (
        <ConfirmDialog
          title={`‘${deleting.name}’을 지울까요?`}
          confirmLabel="삭제"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        >
          <p>오늘 장과 지난 기록까지 모두 바로 사라지고, 되돌릴 수 없어요.</p>
          {deleting.memberCount > 1 && <p>함께 쓰던 참여자 {deleting.memberCount - 1}명도 더는 볼 수 없어요.</p>}
        </ConfirmDialog>
      )}
    </div>
  )
}
