import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

type Member = { id: number; nickname: string; color: string; isOwner: boolean; lastVisitedAt: string }
type Kicked = { id: number; nickname: string; at: string }

/**
 * 만든 사람이 보는 참여자 목록. 참여자를 내보내면 접속해 있어도 바로 나가고, 다시 허용할 때까지 들어오지 못한다.
 * 내보내기는 한 번 더 확인한다.
 */
export function MemberList({ noteId }: { noteId: string }) {
  const [data, setData] = useState<{ members: Member[]; kicked: Kicked[] } | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/notes/${noteId}/members`))
    } catch {
      setError('참여자를 불러오지 못했어요')
    }
  }, [noteId])

  useEffect(() => {
    void load()
  }, [load])

  async function act(run: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await run()
      setConfirming(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '바꾸지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="member-help">{error ?? '참여자를 불러오는 중…'}</p>
  return (
    <div className="member-list">
      <p className="member-list-title">참여자 {data.members.length}명</p>
      <ul>
        {data.members.map((m) => (
          <li key={m.id} className="member-row">
            <span className="member-dot" style={{ background: m.color }} aria-hidden="true" />
            <span className="member-name">
              {m.nickname}
              {m.isOwner && <span className="member-tag">만든 사람</span>}
            </span>
            {!m.isOwner &&
              (confirming === m.id ? (
                <span className="member-confirm">
                  <button
                    type="button"
                    className="member-kick danger"
                    aria-label="내보내기 확인"
                    disabled={busy}
                    onClick={() => void act(() => api(`/api/notes/${noteId}/members/${m.id}/kick`, { method: 'POST' }))}
                  >
                    내보내기
                  </button>
                  <button type="button" className="member-kick" onClick={() => setConfirming(null)}>
                    취소
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="member-kick"
                  aria-label={`${m.nickname} 내보내기`}
                  onClick={() => setConfirming(m.id)}
                >
                  내보내기
                </button>
              ))}
          </li>
        ))}
      </ul>
      {confirming !== null && (
        <p className="member-help">내보내면 바로 나가고, 다시 허용할 때까지 이 노트에 들어오지 못해요.</p>
      )}
      <p className="member-list-title">내보낸 사람</p>
      {data.kicked.length === 0 ? (
        <p className="member-help">내보낸 사람이 없어요.</p>
      ) : (
        <ul>
          {data.kicked.map((k) => (
            <li key={k.id} className="member-row">
              <span className="member-name muted">{k.nickname}</span>
              <button
                type="button"
                className="member-kick"
                aria-label={`${k.nickname} 다시 허용`}
                disabled={busy}
                onClick={() => void act(() => api(`/api/notes/${noteId}/kicked/${k.id}`, { method: 'DELETE' }))}
              >
                다시 허용
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="member-help" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
