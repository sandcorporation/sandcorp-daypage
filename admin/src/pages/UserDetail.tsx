import { useCallback, useEffect, useState } from 'react'
import { api, type UserDetail as User } from '../api'
import { shortTime } from '../format'

const PERIODS = [
  { days: 1, label: '1일' },
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
  { days: null, label: '영구' },
] as const

/** 사용자 하나: 참여한 노트, 정지·정지 풀기(기간과 사유). 운영자는 정지할 수 없다. */
export function UserDetail({ id }: { id: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<1 | 7 | 30 | null>(7)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<User>(`/api/admin/users/${id}`)
      .then(setUser)
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

  if (!user) return error ? <p role="alert">불러오지 못했어요: {error}</p> : <p className="muted">불러오는 중…</p>
  return (
    <div className="detail">
      <p className="small">
        <a href="#users">← 사용자 목록</a>
      </p>
      <h2>사용자 #{user.id}</h2>
      <p className="muted small">
        가입 {shortTime(user.createdAt)}
        {user.isStaff && <span className="badge">운영자</span>}
      </p>

      <section className="panel" aria-labelledby="user-notes">
        <h3 id="user-notes">참여한 노트 {user.notes.length}개</h3>
        <ul className="links">
          {user.notes.map((n) => (
            <li key={n.id}>
              <a href={`#notes/${n.id}`}>{n.name}</a>
              <span className="muted small">
                {' '}
                · {n.nickname}
                {n.isOwner && ' · 만든 사람'} · 마지막 방문 {shortTime(n.lastVisitedAt)}
              </span>
              {n.closed && <span className="badge danger">닫힘</span>}
            </li>
          ))}
        </ul>
      </section>

      {!user.isStaff && (
        <section className="panel danger-zone" aria-labelledby="user-suspend">
          <h3 id="user-suspend">이용 정지</h3>
          {user.suspension ? (
            <>
              <p className="alert">
                정지 중 · {user.suspension.until ? `${shortTime(user.suspension.until)}까지` : '영구'} · 사유: {user.suspension.reason}
              </p>
              <button type="button" className="btn" disabled={busy} onClick={() => void act(`/api/admin/users/${id}/unsuspend`)}>
                정지 풀기
              </button>
            </>
          ) : (
            <>
              <p className="muted small">
                정지 중에는 노트에 들어가거나 새 노트를 만들 수 없어요. 접속해 있으면 바로 나가요. 로그인은 되어 첫 화면에서 사유를 봐요.
              </p>
              <fieldset className="periods">
                <legend className="small">기간</legend>
                {PERIODS.map((p) => (
                  <label key={p.label} className="chip-radio">
                    <input type="radio" name="period" checked={days === p.days} onChange={() => setDays(p.days)} />
                    {p.label}
                  </label>
                ))}
              </fieldset>
              <label className="field">
                <span>정지 사유</span>
                <textarea value={reason} maxLength={200} rows={2} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || !reason.trim()}
                onClick={() => void act(`/api/admin/users/${id}/suspend`, { days, reason: reason.trim() })}
              >
                정지하기
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  )
}
