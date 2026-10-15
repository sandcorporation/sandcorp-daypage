import { useEffect, useState } from 'react'
import { api } from './api/client'

export default function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'down'>('checking')

  useEffect(() => {
    api<{ ok: boolean }>('/api/health')
      .then((r) => setStatus(r.ok ? 'ok' : 'down'))
      .catch(() => setStatus('down'))
  }, [])

  return (
    <main className="grid-bg" style={{ padding: 24 }}>
      <h1>Daypage</h1>
      <p>서버 연결: {status === 'checking' ? '확인 중…' : status === 'ok' ? '정상' : '끊김'}</p>
    </main>
  )
}
