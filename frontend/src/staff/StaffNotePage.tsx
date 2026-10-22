import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, ApiError } from '../api/client'
import { SealedPageView } from '../history/HistoryPage'
import { formatPageKey, formatShortDate, seqSuffix } from '../note/time'
import { normalizePaper } from '../page/paper'
import { ErrorScreen } from '../pages/ErrorScreen'
import '../note/note.css'
import '../history/history.css'
import './staff.css'

type StaffNote = {
  id: string
  name: string
  paper: unknown
  /** 지금 쓰는 장의 키 */
  openPage: string
  closed: { at: string; reason: string } | null
  members: { id: number; userId: number; nickname: string; color: string }[]
  pages: { key: string; date: string; seq: number; participantCount: number; strokeCount: number; paper: unknown }[]
}

/**
 * 운영자 보기: 노트 하나의 오늘 페이지와 지난 페이지를 읽기 전용으로 본다.
 * 참여자가 되지 않고, 열 때마다 운영자 기록에 남는다. 닫기·정지는 운영자 페이지(/admin)에서 한다.
 */
export function StaffNotePage() {
  const { noteId = '', pageKey } = useParams()
  const navigate = useNavigate()
  const [note, setNote] = useState<StaffNote | null>(null)
  const [error, setError] = useState<'missing' | 'server' | null>(null)

  useEffect(() => {
    let cancelled = false
    api<StaffNote>(`/api/admin/notes/${noteId}`)
      .then((n) => !cancelled && setNote(n))
      .catch((e) => {
        if (cancelled) return
        // 운영자가 아니면(401) 노트가 없는 것처럼 보인다
        setError(e instanceof ApiError && (e.status === 401 || e.status === 404) ? 'missing' : 'server')
      })
    return () => {
      cancelled = true
    }
  }, [noteId])

  if (error) return <ErrorScreen kind={error} />
  if (!note) return <div className="grid-bg" />

  const days = [
    { key: note.openPage, label: '열린 페이지', meta: '지금 쓰는 중', paper: note.paper },
    ...note.pages.map((p) => ({
      key: p.key,
      label: formatShortDate(p.date) + seqSuffix(p.seq),
      meta: `참여 ${p.participantCount}명 · 획 ${p.strokeCount}개`,
      paper: p.paper,
    })),
  ]
  const selected = days.find((d) => d.key === pageKey) ?? days[0]

  return (
    <div className="history-screen">
      <header className="note-header staff-header">
        <div className="note-header-left">
          <a href="/admin/" aria-label="운영자 페이지로 돌아가기" className="icon-link">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M13 5l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <div className="note-title">
            <p className="note-name">
              <span className="staff-badge">운영자 보기</span> {note.name}
            </p>
            <p className="note-sub">
              참여자 {note.members.length}명 · 읽기 전용 · 열람이 기록돼요
              {note.closed && <span className="staff-closed"> · 닫힌 노트(사유: {note.closed.reason})</span>}
            </p>
          </div>
        </div>
      </header>
      <main className="history-main">
        <section className="history-list" aria-labelledby="staff-pages-title">
          <h1 id="staff-pages-title">페이지</h1>
          <ol>
            {days.map((d) => (
              <li key={d.key}>
                <button
                  type="button"
                  className="history-item"
                  aria-current={d.key === selected.key ? 'true' : undefined}
                  onClick={() => navigate(`/staff/notes/${noteId}/${d.key}`)}
                >
                  <span className="note-card-thumb" aria-hidden="true" />
                  <span>
                    <span className="history-date">{d.label}</span>
                    <span className="history-meta">{d.meta}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <SealedPageView
          key={selected.key}
          noteId={noteId}
          noteName={note.name}
          pageKey={selected.key}
          label={selected.key === note.openPage ? `열린 페이지 · ${formatPageKey(selected.key)}` : undefined}
          paper={normalizePaper(selected.paper)}
          src={`/api/admin/notes/${noteId}/pages/${selected.key}`}
        />
      </main>
    </div>
  )
}
