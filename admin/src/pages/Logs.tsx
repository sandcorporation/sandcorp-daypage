import { useEffect, useState } from 'react'
import { api, type LogRow } from '../api'
import { shortTime } from '../format'

const ACTION: Record<LogRow['action'], string> = {
  view_note: '노트 열람',
  view_page: '페이지 열람',
  close_note: '노트 닫기',
  reopen_note: '노트 다시 열기',
  suspend_user: '사용자 정지',
  unsuspend_user: '정지 풀기',
}

/** 운영자 기록: 누가 언제 어느 노트를 열어 봤고 어떤 조치를 했는지(최근 순) */
export function Logs() {
  const [rows, setRows] = useState<LogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<LogRow[]>('/api/admin/logs')
      .then(setRows)
      .catch((e) => setError(String(e.message ?? e)))
  }, [])
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>
  if (!rows) return <p className="muted">불러오는 중…</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="muted small">최근 순 · 최대 300개 · 노트 열람과 조치는 모두 남아요</caption>
        <thead>
          <tr>
            <th scope="col">시각</th>
            <th scope="col">운영자</th>
            <th scope="col">한 일</th>
            <th scope="col">대상</th>
            <th scope="col">내용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{shortTime(r.at)}</td>
              <td>{r.staffId === null ? '—' : `#${r.staffId}`}</td>
              <td>{ACTION[r.action] ?? r.action}</td>
              <td>
                {r.noteId && <a href={`#notes/${r.noteId}`}>{r.noteName ?? r.noteId}</a>}
                {r.targetUserId !== null && <a href={`#users/${r.targetUserId}`}>사용자 #{r.targetUserId}</a>}
              </td>
              <td>{r.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
