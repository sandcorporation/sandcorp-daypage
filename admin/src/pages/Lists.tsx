import { useEffect, useState } from 'react'
import { api, type NoteRow, type UserRow } from '../api'
import { bytes, shortTime } from '../format'

function useList<T>(path: string) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<T[]>(path)
      .then(setRows)
      .catch((e) => setError(String(e.message ?? e)))
  }, [path])
  return { rows, error }
}

/** 노트 목록: 내용 없이 개수·날짜만(최근에 열린 순) */
export function Notes() {
  const { rows, error } = useList<NoteRow>('/api/admin/notes')
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>
  if (!rows) return <p className="muted">불러오는 중…</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="muted small">최근에 열린 순 · 최대 300개 · 노트를 열면 참여자·페이지와 읽기 전용 보기가 있어요(열람 기록)</caption>
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col" className="num">참여</th>
            <th scope="col" className="num">페이지</th>
            <th scope="col" className="num">오늘 크기</th>
            <th scope="col">마지막 방문</th>
            <th scope="col">만든 날</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id}>
              <td>
                <a href={`#notes/${n.id}`}>{n.name}</a>
                {n.closed && <span className="badge danger">닫힘</span>}
                <span className="muted small"> · 만든 사람 #{n.ownerId}</span>
              </td>
              <td className="num">
                {n.memberCount}
                {n.memberLimit !== null && <span className="muted">/{n.memberLimit}</span>}
              </td>
              <td className="num">{n.pageCount}</td>
              <td className="num">{n.todayBytes ? bytes(n.todayBytes) : '—'}</td>
              <td>{shortTime(n.lastVisitedAt)}</td>
              <td>{shortTime(n.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 사용자 목록: 번호와 개수만(카카오 정보는 없음) */
export function Users() {
  const { rows, error } = useList<UserRow>('/api/admin/users')
  if (error) return <p role="alert">불러오지 못했어요: {error}</p>
  if (!rows) return <p className="muted">불러오는 중…</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="muted small">최근에 노트를 연 순 · 최대 300명 · 카카오 정보는 보관하지 않습니다</caption>
        <thead>
          <tr>
            <th scope="col">사용자</th>
            <th scope="col" className="num">만든 노트</th>
            <th scope="col" className="num">참여 노트</th>
            <th scope="col" className="num">건의</th>
            <th scope="col">마지막 방문</th>
            <th scope="col">가입</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>
                <a href={`#users/${u.id}`}>#{u.id}</a>
                {u.isStaff && <span className="badge">운영자</span>}
                {u.suspended && <span className="badge danger">정지</span>}
              </td>
              <td className="num">{u.ownedNotes}</td>
              <td className="num">{u.memberships}</td>
              <td className="num">{u.suggestions}</td>
              <td>{shortTime(u.lastVisitedAt)}</td>
              <td>{shortTime(u.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
