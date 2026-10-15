import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import * as Y from 'yjs'
import { api, ApiError } from '../api/client'
import { useToast } from '../components/Toast'
import { formatShortDate } from '../note/time'
import type { NoteDetail } from '../note/types'
import { downloadBlob, exportFileName, renderPagePng } from '../page/exportPng'
import { PageView } from '../page/PageView'
import { TextLayer } from '../page/TextLayer'
import { ErrorScreen } from '../pages/ErrorScreen'
import '../note/note.css'
import './history.css'

type SealedPage = { date: string; participantCount: number; strokeCount: number }

const noop = () => {}
const NO_EDITORS = new Map()

export function HistoryPage() {
  const { noteId = '', date } = useParams()
  const navigate = useNavigate()
  const [note, setNote] = useState<NoteDetail | null>(null)
  const [pages, setPages] = useState<SealedPage[] | null>(null)
  const [error, setError] = useState<'missing' | 'server' | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api<NoteDetail>(`/api/notes/${noteId}`), api<SealedPage[]>(`/api/notes/${noteId}/pages`)])
      .then(([n, p]) => {
        if (cancelled) return
        setNote(n)
        setPages(p)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 401) {
          window.location.href = `/note/${noteId}`
          return
        }
        setError(e instanceof ApiError && (e.status === 404 || e.status === 403) ? 'missing' : 'server')
      })
    return () => {
      cancelled = true
    }
  }, [noteId])

  const selected = date ?? pages?.[0]?.date ?? null

  if (error) return <ErrorScreen kind={error} />
  if (!note || !pages) return <div className="grid-bg" />

  return (
    <div className="history-screen">
      <header className="note-header">
        <div className="note-header-left">
          <Link to={`/note/${noteId}`} aria-label="오늘 장으로 돌아가기" className="icon-link">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M13 5l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="note-title">
            <p className="note-name">{note.name} · 기록</p>
            <p className="note-sub">지난 장은 보기만 할 수 있어요</p>
          </div>
        </div>
        <Link to={`/note/${noteId}`} className="btn btn-primary">
          오늘 장 열기
        </Link>
      </header>

      {pages.length === 0 ? (
        <main className="history-empty">
          <p className="hand">아직 지난 장이 없어요</p>
          <p>밤 12시가 지나면 오늘 장이 이곳에 기록돼요.</p>
        </main>
      ) : (
        <main className="history-main">
          <section className="history-list" aria-labelledby="history-title">
            <h1 id="history-title">지난 장</h1>
            <ol>
              {pages.map((p) => (
                <li key={p.date}>
                  <button
                    type="button"
                    className="history-item"
                    aria-current={p.date === selected ? 'true' : undefined}
                    onClick={() => navigate(`/note/${noteId}/history/${p.date}`)}
                  >
                    <span className="note-card-thumb" aria-hidden="true" />
                    <span>
                      <span className="history-date">{formatShortDate(p.date)}</span>
                      <span className="history-meta">
                        참여 {p.participantCount}명 · 획 {p.strokeCount}개
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          {selected && <SealedPageView key={selected} noteId={noteId} noteName={note.name} date={selected} />}
        </main>
      )}
    </div>
  )
}

function SealedPageView({ noteId, noteName, date }: { noteId: string; noteName: string; date: string }) {
  const doc = useMemo(() => new Y.Doc(), [])
  const [loaded, setLoaded] = useState<'loading' | 'ok' | 'missing'>('loading')
  const [scale, setScale] = useState(0.5)
  const [saving, setSaving] = useState(false)
  const { toast, show } = useToast()

  useEffect(() => {
    api<ArrayBuffer>(`/api/notes/${noteId}/pages/${date}`)
      .then((buf) => {
        Y.applyUpdate(doc, new Uint8Array(buf))
        setLoaded('ok')
      })
      .catch(() => setLoaded('missing'))
  }, [doc, noteId, date])

  async function save() {
    setSaving(true)
    try {
      downloadBlob(await renderPagePng(doc, 1), exportFileName(noteName, date))
    } catch {
      show('이미지를 만들지 못했어요')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="history-view" aria-label={`${formatShortDate(date)} 장`}>
      <div className="history-view-head">
        <h2>{formatShortDate(date)}</h2>
        <div className="history-view-actions">
          <span className="readonly-badge">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            읽기 전용
          </span>
          <button type="button" className="btn" onClick={save} disabled={loaded !== 'ok' || saving}>
            {saving ? '저장하는 중…' : '이미지로 저장'}
          </button>
        </div>
      </div>
      {loaded === 'missing' ? (
        <p className="empty">이 장을 불러오지 못했어요.</p>
      ) : (
        <PageView doc={doc} tool="select" ink="#000" widthLevel={1} author="" readOnly onScale={setScale}>
          <TextLayer
            doc={doc}
            tool="select"
            scale={scale}
            readOnly
            origin={null}
            focusId={null}
            onFocusHandled={noop}
            onEditing={noop}
            editors={NO_EDITORS}
            me=""
          />
        </PageView>
      )}
      {toast}
    </section>
  )
}
