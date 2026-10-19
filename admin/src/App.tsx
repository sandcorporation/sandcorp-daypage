import { useEffect, useState } from 'react'
import { api, type Me } from './api'
import { Dashboard } from './pages/Dashboard'
import { Notes, Users } from './pages/Lists'
import { Suggestions } from './pages/Suggestions'

const TABS = [
  { id: 'dashboard', label: '현황', view: Dashboard },
  { id: 'suggestions', label: '건의함', view: Suggestions },
  { id: 'notes', label: '노트', view: Notes },
  { id: 'users', label: '사용자', view: Users },
] as const

type TabId = (typeof TABS)[number]['id']

function tabFromHash(): TabId {
  const id = window.location.hash.slice(1)
  return (TABS.find((t) => t.id === id)?.id ?? 'dashboard') as TabId
}

export function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<TabId>(tabFromHash)

  useEffect(() => {
    api<Me>('/api/me')
      .then(setMe)
      .catch(() => setMe({ authenticated: false, isStaff: false }))
    const onHash = () => setTab(tabFromHash())
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
      <main className="content">
        <View />
      </main>
    </div>
  )
}
