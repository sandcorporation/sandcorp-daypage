import { useCallback, useEffect, useState } from 'react'
import { api, type Suggestion, type SuggestionStatus } from '../api'
import { shortTime } from '../format'

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  new: '새 건의',
  reviewing: '검토 중',
  done: '반영함',
  declined: '안 함',
}

const FILTERS: (SuggestionStatus | 'all')[] = ['all', 'new', 'reviewing', 'done', 'declined']

export function Suggestions() {
  const [filter, setFilter] = useState<SuggestionStatus | 'all'>('new')
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    const q = filter === 'all' ? '' : `?status=${filter}`
    api<Suggestion[]>(`/api/admin/suggestions${q}`)
      .then(setItems)
      .catch((e) => setError(String(e.message ?? e)))
  }, [filter])
  useEffect(load, [load])

  async function change(id: number, status: SuggestionStatus) {
    await api(`/api/admin/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    // 지금 거르는 상태에서 빠진 건의는 목록에서도 뺀다
    setItems((list) => (list ?? []).flatMap((s) => (s.id !== id ? [s] : filter === 'all' || filter === status ? [{ ...s, status }] : [])))
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
      {error && <p role="alert">불러오지 못했어요: {error}</p>}
      {items === null && !error && <p className="muted">불러오는 중…</p>}
      {items?.length === 0 && <p className="muted">건의가 없어요.</p>}
      <ul className="cards">
        {items?.map((s) => (
          <li key={s.id} className="card">
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
              <label className="status-select">
                <span className="sr-only">상태</span>
                <select value={s.status} onChange={(e) => void change(s.id, e.target.value as SuggestionStatus)}>
                  {(Object.keys(STATUS_LABEL) as SuggestionStatus[]).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
