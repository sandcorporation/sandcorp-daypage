import { useEffect, useState } from 'react'
import { api, type Stats } from '../api'
import { BarChart } from '../BarChart'
import { dayLabel } from '../format'

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="tile">
      <p className="tile-label">{label}</p>
      <p className="tile-value">{value}</p>
      {sub && <p className="tile-sub">{sub}</p>}
    </div>
  )
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      api<Stats>('/api/admin/stats')
        .then((s) => alive && setStats(s))
        .catch((e) => alive && setError(String(e.message ?? e)))
    void load()
    // 지금 접속 수가 바뀌므로 30초마다 다시 읽는다
    const timer = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  if (error) return <p role="alert">불러오지 못했어요: {error}</p>
  if (!stats) return <p className="muted">불러오는 중…</p>

  const { totals, today, online, daily, hourly } = stats
  return (
    <div className="stack">
      <section className="tiles" aria-label="한눈에">
        <Tile label="지금 접속" value={online.users} sub={`연결 ${online.connections}${online.capacity !== null ? ` · 수용 ${online.capacity}` : ''}${online.waiting ? ` · 대기 ${online.waiting}` : ''}`} />
        <Tile label="오늘 방문" value={today.visitors} sub="오늘 노트를 연 사람" />
        <Tile label="오늘 가입" value={today.signups} sub={`누적 ${totals.users}명`} />
        <Tile label="오늘 새 노트" value={today.notes} sub={`누적 ${totals.notes}개`} />
        <Tile label="새 건의" value={stats.suggestions.new} sub="아직 안 읽음" />
      </section>

      <section className="panel" aria-labelledby="daily-title">
        <h2 id="daily-title">최근 14일</h2>
        <div className="charts">
          <BarChart title="가입" bars={daily.map((d) => ({ label: dayLabel(d.date), value: d.signups }))} labelEvery={2} />
          <BarChart title="새 노트" bars={daily.map((d) => ({ label: dayLabel(d.date), value: d.notes }))} labelEvery={2} />
          <BarChart
            title="쓴 노트(내용 있는 페이지)"
            bars={daily.map((d) => ({
              label: dayLabel(d.date),
              value: d.activeNotes,
              detail: d.participants !== null ? `참여 ${d.participants}명` : '오늘(봉인 전)',
            }))}
            labelEvery={2}
          />
        </div>
      </section>

      <section className="panel" aria-labelledby="hourly-title">
        <h2 id="hourly-title">오늘 시간대별</h2>
        <div className="charts">
          <BarChart title="노트를 연 사람(마지막 방문 시각)" bars={hourly.map((h) => ({ label: `${h.hour}시`, value: h.lastVisits }))} labelEvery={3} />
          <BarChart title="가입" bars={hourly.map((h) => ({ label: `${h.hour}시`, value: h.signups }))} labelEvery={3} />
        </div>
        <p className="muted small">‘노트를 연 사람’은 사람마다 노트별 마지막 방문 시각으로 셉니다. 같은 사람이 여러 번 들어와도 마지막 한 번만 잡힙니다.</p>
      </section>
    </div>
  )
}
