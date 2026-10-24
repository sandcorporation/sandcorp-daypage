import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import * as Y from 'yjs'
import { api, ApiError } from '../api/client'
import { useToast } from '../components/Toast'
import { formatHourRange, formatPageKey, formatShortDate, seqSuffix } from '../note/time'
import { ZoomControl, type Zoom } from '../note/ZoomControl'
import type { NoteDetail } from '../note/types'
import { bookFileName, bookOrder, renderNoteBook } from '../page/exportPdf'
import { downloadBlob, exportFileName, renderPagePng } from '../page/exportPng'
import { normalizePaper, type Paper } from '../page/paper'
import { PageView } from '../page/PageView'
import { TextLayer } from '../page/TextLayer'
import { PhotoImages } from '../page/PhotoLayer'
import { photoBase } from '../page/photos'
import { blockedKind, ErrorScreen, type BlockedKind } from '../pages/ErrorScreen'
import '../note/note.css'
import './history.css'

type SealedPage = {
  key: string
  date: string
  seq: number
  openedAt: string
  closedAt: string
  participantCount: number
  strokeCount: number
  paper?: unknown
}

const noop = () => {}
const NO_EDITORS = new Map()

export function HistoryPage() {
  const { noteId = '', pageKey } = useParams()
  const navigate = useNavigate()
  const [note, setNote] = useState<NoteDetail | null>(null)
  const [pages, setPages] = useState<SealedPage[] | null>(null)
  const [error, setError] = useState<'missing' | 'server' | null>(null)
  const [blocked, setBlocked] = useState<{ kind: BlockedKind; detail: string } | null>(null)
  const [binding, setBinding] = useState<{ done: number; total: number } | null>(null)
  const { toast, show } = useToast()

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
        const kind = e instanceof ApiError ? blockedKind(e.code) : null
        if (kind) return setBlocked({ kind, detail: (e as ApiError).message })
        setError(e instanceof ApiError && (e.status === 404 || e.status === 403) ? 'missing' : 'server')
      })
    return () => {
      cancelled = true
    }
  }, [noteId])

  const selected = pageKey ?? pages?.[0]?.key ?? null

  /** 지난 페이지를 모두 받아 날짜순으로 엮은 PDF 책을 내려받는다. 장은 하나씩 받아 그린다. */
  async function saveBook() {
    if (!note || !pages || pages.length === 0 || binding) return
    setBinding({ done: 0, total: pages.length })
    try {
      const ordered = bookOrder(pages)
      const blob = await renderNoteBook({
        noteName: note.name,
        memberCount: note.memberCount,
        pages: ordered.map((p) => ({
          page: { ...p, paper: normalizePaper(p.paper) },
          load: async () => {
            const doc = new Y.Doc()
            Y.applyUpdate(doc, new Uint8Array(await api<ArrayBuffer>(`/api/notes/${noteId}/pages/${p.key}`)))
            return doc
          },
        })),
        photos: photoBase(noteId),
        onProgress: (done, total) => setBinding({ done, total }),
      })
      downloadBlob(blob, bookFileName(note.name, ordered[0].date, ordered[ordered.length - 1].date))
    } catch {
      show('책을 만들지 못했어요')
    } finally {
      setBinding(null)
    }
  }

  if (blocked) return <ErrorScreen kind={blocked.kind} detail={blocked.detail} />
  if (error) return <ErrorScreen kind={error} />
  if (!note || !pages) return <div className="grid-bg" />

  return (
    <div className="history-screen">
      <header className="note-header">
        <div className="note-header-left">
          <Link to={`/note/${noteId}`} aria-label="오늘 페이지로 돌아가기" className="icon-link">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M13 5l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="note-title">
            <p className="note-name">{note.name} · 기록</p>
            <p className="note-sub">지난 페이지는 보기만 할 수 있어요</p>
          </div>
        </div>
        <Link to={`/note/${noteId}`} className="btn btn-primary">
          오늘 페이지 열기
        </Link>
      </header>

      {pages.length === 0 ? (
        <main className="history-empty">
          <p className="hand">아직 지난 페이지가 없어요</p>
          <p>새 페이지가 열리는 시각(기본 밤 12시)이 지나면 쓰던 페이지가 이곳에 보관돼요.</p>
        </main>
      ) : (
        <main className="history-main">
          <section className="history-list" aria-labelledby="history-title">
            <div className="history-list-head">
              <h1 id="history-title">지난 페이지</h1>
              <button
                type="button"
                className="btn"
                onClick={saveBook}
                disabled={binding !== null}
                title="지난 페이지를 모두 날짜순으로 엮은 PDF를 내려받아요"
              >
                {binding ? `엮는 중… ${binding.done}/${binding.total}` : '책으로 저장 (PDF)'}
              </button>
            </div>
            <ol>
              {pages.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    className="history-item"
                    aria-current={p.key === selected ? 'true' : undefined}
                    onClick={() => navigate(`/note/${noteId}/history/${p.key}`)}
                  >
                    <span className="note-card-thumb" aria-hidden="true" />
                    <span>
                      <span className="history-date">
                        {formatShortDate(p.date)}
                        {seqSuffix(p.seq)}
                      </span>
                      <span className="history-meta">
                        {formatHourRange(p.openedAt, p.closedAt) && `${formatHourRange(p.openedAt, p.closedAt)} · `}
                        참여 {p.participantCount}명 · 획 {p.strokeCount}개
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          {selected && (
            <SealedPageView
              key={selected}
              noteId={noteId}
              noteName={note.name}
              pageKey={selected}
              paper={normalizePaper(pages?.find((p) => p.key === selected)?.paper)}
            />
          )}
        </main>
      )}
      {toast}
    </div>
  )
}

/** 장 하나를 읽기 전용으로 보인다. src를 주면 그 주소에서 문서를 받는다(운영자 보기). */
export function SealedPageView({
  noteId,
  noteName,
  pageKey,
  paper,
  src,
  photos,
  label,
}: {
  noteId: string
  noteName: string
  /** 장의 키(`2026-10-21`, `2026-10-21-2`) */
  pageKey: string
  paper: Paper
  src?: string
  /** 사진 주소 앞부분(없으면 참여자용 photoBase(noteId)) */
  photos?: string
  /** 제목(없으면 날짜) */
  label?: string
}) {
  const doc = useMemo(() => new Y.Doc(), [])
  const [loaded, setLoaded] = useState<'loading' | 'ok' | 'missing'>('loading')
  const [scale, setScale] = useState(0.5)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const onZoom = useCallback((z: number) => setZoom(z), [])
  const [saving, setSaving] = useState(false)
  const { toast, show } = useToast()
  const photoSrc = photos ?? photoBase(noteId)

  useEffect(() => {
    api<ArrayBuffer>(src ?? `/api/notes/${noteId}/pages/${pageKey}`)
      .then((buf) => {
        Y.applyUpdate(doc, new Uint8Array(buf))
        setLoaded('ok')
      })
      .catch(() => setLoaded('missing'))
  }, [doc, noteId, pageKey, src])

  async function save() {
    setSaving(true)
    try {
      downloadBlob(await renderPagePng(doc, 1, paper, photoSrc), exportFileName(noteName, pageKey))
    } catch {
      show('이미지를 만들지 못했어요')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="history-view" aria-label={`${formatPageKey(pageKey)} 페이지`}>
      <div className="history-view-head">
        <h2>{label ?? formatPageKey(pageKey)}</h2>
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
        <p className="empty">이 페이지를 불러오지 못했어요.</p>
      ) : (
        <PageView
          doc={doc}
          paper={paper}
          tool="select"
          ink="#000"
          widthLevel={1}
          author=""
          readOnly
          onScale={setScale}
          zoom={zoom}
          onZoom={onZoom}
          underlay={<PhotoImages doc={doc} base={photoSrc} />}
        >
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
      <ZoomControl scale={scale} zoom={zoom} onZoom={setZoom} />
      {toast}
    </section>
  )
}
