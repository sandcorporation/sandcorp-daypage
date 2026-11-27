import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'

type Member = { id: number; nickname: string; color: string; isOwner: boolean; lastVisitedAt: string }
type Kicked = { id: number; nickname: string; at: string }

/** 화면이 바뀐 뒤 초점을 둘 자리(data-focus-key). 없으면 목록 제목에 둔다. */
type FocusKey = 'title' | 'confirm' | `kick:${number}` | `allow:${number}`

/**
 * 만든 사람이 보는 참여자 목록. 참여자를 내보내면 접속해 있어도 바로 나가고, 다시 허용할 때까지 들어오지 못한다.
 * 내보내기는 한 번 더 확인한다.
 */
export function MemberList({ noteId }: { noteId: string }) {
  const [data, setData] = useState<{ members: Member[]; kicked: Kicked[] } | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // from이 있으면(요청 뒤) 초점이 아직 그 단추나 body에 있을 때만 옮긴다
  const pendingFocus = useRef<{ key: FocusKey; from?: Element | null } | null>(null)

  useEffect(() => {
    const pending = pendingFocus.current
    // 요청하는 동안에는 단추가 disabled라 초점을 받지 못한다
    if (!pending || busy) return
    pendingFocus.current = null
    const active = document.activeElement
    if (pending.from !== undefined && active !== document.body && active !== pending.from) return
    const find = (key: FocusKey) => listRef.current?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)
    const target = find(pending.key) ?? find('title')
    target?.focus()
  })

  function showConfirm(id: number) {
    pendingFocus.current = { key: 'confirm' }
    setConfirming(id)
  }

  const cancelConfirm = useCallback((id: number) => {
    pendingFocus.current = { key: `kick:${id}` }
    setConfirming(null)
  }, [])

  // 확인 단계의 Escape는 확인만 거둔다. 팝오버를 닫는 window 듣개(useDismiss)보다 먼저 잡고 멈춘다.
  useEffect(() => {
    if (confirming === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const popover = listRef.current?.closest('[role="dialog"]') ?? listRef.current
      const active = document.activeElement
      if (active !== document.body && !popover?.contains(active)) return
      e.stopPropagation()
      if (!busy) cancelConfirm(confirming)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirming, busy, cancelConfirm])

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

  /** next는 성공한 뒤 초점을 둘 자리. 실패하면 누른 단추에 남긴다. */
  async function act(run: () => Promise<unknown>, next: FocusKey) {
    const from = document.activeElement
    const own = from?.getAttribute('data-focus-key') as FocusKey | null | undefined
    setBusy(true)
    setError(null)
    try {
      await run()
      await load()
      setConfirming(null)
      pendingFocus.current = { key: next, from }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '바꾸지 못했어요')
      if (own) pendingFocus.current = { key: own, from }
    } finally {
      setBusy(false)
    }
  }

  /** 목록에서 index 다음 사람의 단추. 없으면 목록 제목. */
  function nextKick(members: Member[], index: number): FocusKey {
    const next = members.slice(index + 1).find((m) => !m.isOwner)
    return next ? `kick:${next.id}` : 'title'
  }

  if (!data) return <p className="member-help">{error ?? '참여자를 불러오는 중…'}</p>
  return (
    <div className="member-list" ref={listRef}>
      <p className="member-list-title" data-focus-key="title" tabIndex={-1}>
        참여자 {data.members.length}명
      </p>
      <ul>
        {data.members.map((m, index) => (
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
                    data-focus-key="confirm"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api(`/api/notes/${noteId}/members/${m.id}/kick`, { method: 'POST' }),
                        nextKick(data.members, index),
                      )
                    }
                  >
                    내보내기
                  </button>
                  <button type="button" className="member-kick" onClick={() => cancelConfirm(m.id)}>
                    취소
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="member-kick"
                  aria-label={`${m.nickname} 내보내기`}
                  data-focus-key={`kick:${m.id}`}
                  onClick={() => showConfirm(m.id)}
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
          {data.kicked.map((k, index) => (
            <li key={k.id} className="member-row">
              <span className="member-name muted">{k.nickname}</span>
              <button
                type="button"
                className="member-kick"
                aria-label={`${k.nickname} 다시 허용`}
                data-focus-key={`allow:${k.id}`}
                disabled={busy}
                onClick={() => {
                  const next = data.kicked[index + 1]
                  void act(
                    () => api(`/api/notes/${noteId}/kicked/${k.id}`, { method: 'DELETE' }),
                    next ? `allow:${next.id}` : 'title',
                  )
                }}
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
