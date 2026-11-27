import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Suggestion, type SuggestionStatus } from '../api'
import { shortTime } from '../format'

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  new: '새 건의',
  reviewing: '검토 중',
  done: '반영함',
  declined: '안 함',
}

/** STATUS_LABEL 뒤에 붙는 조사 */
const STATUS_PARTICLE: Record<SuggestionStatus, string> = {
  new: '로',
  reviewing: '으로',
  done: '으로',
  declined: '으로',
}

const FILTERS: (SuggestionStatus | 'all')[] = ['all', 'new', 'reviewing', 'done', 'declined']

export function Suggestions() {
  const [filter, setFilter] = useState<SuggestionStatus | 'all'>('new')
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [notice, setNotice] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  // 카드가 빠진 뒤 초점이 갈 자리: 다음 카드, 없으면(null) 목록 제목
  const [removed, setRemoved] = useState<{ next: HTMLElement | null } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const filterRef = useRef(filter)
  useEffect(() => {
    filterRef.current = filter
  }, [filter])
  useEffect(() => {
    // 초점이 빠진 카드와 함께 사라졌을 때만 옮긴다. 다른 곳으로 옮긴 초점은 그대로 둔다
    if (!removed || (document.activeElement && document.activeElement !== document.body)) return
    const target = removed.next?.isConnected ? removed.next : headingRef.current
    target?.focus()
  }, [removed])

  const load = useCallback(() => {
    const q = filter === 'all' ? '' : `?status=${filter}`
    api<Suggestion[]>(`/api/admin/suggestions${q}`)
      .then(setItems)
      .catch((e) => setError(String(e.message ?? e)))
  }, [filter])
  useEffect(load, [load])

  async function change(id: number, status: SuggestionStatus, card: HTMLElement) {
    setNotice('')
    setSaveError(null)
    try {
      await api(`/api/admin/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    } catch (e) {
      setSaveError(String((e as Error).message ?? e))
      return
    }
    // 지금 거르는 상태에서 빠진 건의는 목록에서도 뺀다
    const stays = filterRef.current === 'all' || filterRef.current === status
    if (!stays) setRemoved({ next: card.nextElementSibling as HTMLElement | null })
    setItems((list) => (list ?? []).flatMap((s) => (s.id !== id ? [s] : stays ? [{ ...s, status }] : [])))
    setNotice(`상태를 ${STATUS_LABEL[status]}${STATUS_PARTICLE[status]} 바꿨어요`)
  }

  return (
    <div className="stack">
      <div className="filters" role="group" aria-label="상태로 거르기">
        {FILTERS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? '전체' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="list-title">
        건의 목록
      </h2>
      <p role="status" className="action-result">
        {notice}
      </p>
      {error && <p role="alert">불러오지 못했어요: {error}</p>}
      {saveError && <p role="alert">바꾸지 못했어요: {saveError}</p>}
      {items === null && !error && <p className="muted">불러오는 중…</p>}
      {items?.length === 0 && <p className="muted">건의가 없어요.</p>}
      <ul className="cards">
        {items?.map((s) => (
          <li key={s.id} className="card" tabIndex={-1}>
            <p className="card-text">{s.text}</p>
            {s.context && Object.keys(s.context).length > 0 && (
              <details className="card-context">
                <summary>화면 상태</summary>
                <dl>
                  {Object.entries(s.context).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v === null ? 'null' : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            <div className="card-meta">
              <span>{shortTime(s.createdAt)}</span>
              <span>사용자 #{s.userId ?? '—'}</span>
              {s.noteName && <span>노트 ‘{s.noteName}’</span>}
              <StatusForm status={s.status} onSave={(status, card) => change(s.id, status, card)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 상태는 골라 두기만 하고 「바꾸기」(또는 상태 칸의 Enter)로 저장한다. 화살표로 고르는 동안에는 저장하지 않는다. */
function StatusForm({
  status,
  onSave,
}: {
  status: SuggestionStatus
  onSave: (status: SuggestionStatus, card: HTMLElement) => Promise<void>
}) {
  const [draft, setDraft] = useState(status)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const idle = draft === status || saving

  async function save(form: HTMLFormElement) {
    if (inFlight.current || draft === status) return
    inFlight.current = true
    setSaving(true)
    try {
      await onSave(draft, form.closest('li')!)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <form
      className="status-select"
      onSubmit={(e) => {
        e.preventDefault()
        void save(e.currentTarget)
      }}
    >
      <label>
        <span className="sr-only">상태</span>
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value as SuggestionStatus)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.currentTarget.form!.requestSubmit()
          }}
        >
          {(Object.keys(STATUS_LABEL) as SuggestionStatus[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {/* disabled로 두면 저장 뒤 이 단추에 있던 초점이 빠진다 */}
      <button type="submit" className="btn btn-small" aria-disabled={idle}>
        바꾸기
      </button>
    </form>
  )
}
