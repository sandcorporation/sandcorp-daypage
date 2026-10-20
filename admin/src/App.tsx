import { useEffect, useState } from 'react'
import { api, type Me } from './api'
import { Dashboard } from './pages/Dashboard'
import { Notes, Users } from './pages/Lists'
import { Logs } from './pages/Logs'
import { NoteDetail } from './pages/NoteDetail'
import { Suggestions } from './pages/Suggestions'
import { UserDetail } from './pages/UserDetail'

const TABS = [
  { id: 'dashboard', label: '현황', view: Dashboard },
  { id: 'suggestions', label: '건의함', view: Suggestions },
  { id: 'notes', label: '노트', view: Notes },
  { id: 'users', label: '사용자', view: Users },
  { id: 'logs', label: '운영 기록', view: Logs },
] as const

type TabId = (typeof TABS)[number]['id']

/** '#notes/abc' → 노트 탭의 노트 abc */
type Route = { tab: TabId; sub: string | null }

function routeFromHash(): Route {
  const [id, ...rest] = window.location.hash.slice(1).split('/')
  const tab = (TABS.find((t) => t.id === id)?.id ?? 'dashboard') as TabId
  return { tab, sub: rest.length ? decodeURIComponent(rest.join('/')) : null }
}

export function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [route, setRoute] = useState<Route>(routeFromHash)
  const tab = route.tab

  useEffect(() => {
    api<Me>('/api/me')
      .then(setMe)
      .catch(() => setMe({ authenticated: false, isStaff: false }))
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!me) return <p className="gate muted">확인하는 중…</p>
  if (!me.authenticated) {
    return (
      <main className="gate">
        <h1>Daypage 운영</h1>
        <p>운영자 계정으로 로그인해 주세요.</p>
        <a className="btn btn-primary" href="/auth/kakao/login?next=/admin/">
          카카오로 로그인
        </a>
      </main>
    )
  }
  if (!me.isStaff) {
    return (
      <main className="gate">
        <h1>권한 없음</h1>
        <p>이 계정은 운영자가 아니에요.</p>
        <a className="btn" href="/">
          Daypage로 돌아가기
        </a>
      </main>
    )
  }

  const View = TABS.find((t) => t.id === tab)!.view
  const body =
    tab === 'notes' && route.sub ? (
      <NoteDetail key={route.sub} id={route.sub} />
    ) : tab === 'users' && route.sub ? (
      <UserDetail key={route.sub} id={route.sub} />
    ) : (
      <View />
    )
  return (
    <div className="shell">
      <header className="top">
        <h1>Daypage 운영</h1>
        <nav aria-label="운영 메뉴" className="tabs">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="tab" aria-current={tab === t.id ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
        <a className="muted small" href="/">
          Daypage 열기
        </a>
      </header>
      <main className="content">{body}</main>
    </div>
  )
}
