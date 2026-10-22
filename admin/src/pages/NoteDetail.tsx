import { useCallback, useEffect, useState } from 'react'
import { api, type NoteDetail as Note } from '../api'
import { dayLabel, shortTime } from '../format'

/**
 * 노트 하나: 참여자와 페이지 목록, 읽기 전용 보기 링크(Daypage의 운영자 보기 화면), 닫기·다시 열기.
 * 이 화면을 여는 것과 페이지를 보는 것은 운영자 기록에 남는다.
 */
export function NoteDetail({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<Note>(`/api/admin/notes/${id}`)
      .then(setNote)
      .catch((e) => setError(String(e.message ?? e)))
  }, [id])
  useEffect(load, [load])

  async function act(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      await api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
      setReason('')
      load()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  if (!note) return error ? <p role="alert">불러오지 못했어요: {error}</p> : <p className="muted">불러오는 중…</p>
  return (
    <div className="detail">
      <p className="small">
        <a href="#notes">← 노트 목록</a>
      </p>
      <h2>{note.name}</h2>
      <p className="muted small">
        만든 사람 <a href={`#users/${note.ownerId}`}>#{note.ownerId}</a> · 만든 날 {shortTime(note.createdAt)} · 참여자{' '}
        {note.members.length}명{note.memberLimit !== null && ` / 정원 ${note.memberLimit}명`}
      </p>

      <section className="panel" aria-labelledby="note-view">
        <h3 id="note-view">내용 보기(읽기 전용)</h3>
        <p className="muted small">Daypage의 운영자 보기 화면에서 열려요. 열 때마다 운영자 기록에 남아요.</p>
        <ul className="links">
          <li>
            <a href={`/staff/notes/${note.id}/${note.openPage}`}>지금 쓰는 장 보기</a>
          </li>
          {note.pages.map((p) => (
            <li key={p.key}>
              <a href={`/staff/notes/${note.id}/${p.key}`}>
                {dayLabel(p.date)}
                {p.seq > 1 ? ` (${p.seq})` : ''} · 참여 {p.participantCount}명 · 획 {p.strokeCount}개
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="note-members">
        <h3 id="note-members">참여자</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">닉네임</th>
                <th scope="col">사용자</th>
                <th scope="col">들어온 날</th>
                <th scope="col">마지막 방문</th>
              </tr>
            </thead>
            <tbody>
              {note.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="dot" style={{ background: m.color }} aria-hidden="true" />
                    {m.nickname}
                    {m.userId === note.ownerId && <span className="badge">만든 사람</span>}
                  </td>
                  <td>
                    <a href={`#users/${m.userId}`}>#{m.userId}</a>
                  </td>
                  <td>{shortTime(m.joinedAt)}</td>
                  <td>{shortTime(m.lastVisitedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel danger-zone" aria-labelledby="note-close">
        <h3 id="note-close">노트 닫기</h3>
        {note.closed ? (
          <>
            <p className="alert">
              닫힌 노트예요 · {shortTime(note.closed.at)} · 사유: {note.closed.reason}
            </p>
            <p className="muted small">참여자는 들어올 수 없고 '운영 정책에 따라 닫힌 노트'라는 안내와 사유를 봐요.</p>
            <button type="button" className="btn" disabled={busy} onClick={() => void act(`/api/admin/notes/${id}/reopen`)}>
              다시 열기
            </button>
          </>
        ) : (
          <>
            <p className="muted small">
              지우지 않고 닫아요. 접속해 있는 사람은 바로 나가고, 다시 열 때까지 아무도 들어오지 못해요. 사유는 참여자에게 보여요.
            </p>
            <label className="field">
              <span>닫는 사유</span>
              <textarea value={reason} maxLength={200} rows={2} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !reason.trim()}
              onClick={() => void act(`/api/admin/notes/${id}/close`, { reason: reason.trim() })}
            >
              노트 닫기
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  )
}
