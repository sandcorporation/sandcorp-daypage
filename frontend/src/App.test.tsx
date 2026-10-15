import { render, screen } from '@testing-library/react'
import App from './App'

test('health 응답이 정상이면 서버 연결 정상을 표시한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })),
  )
  render(<App />)
  expect(await screen.findByText(/서버 연결: 정상/)).toBeInTheDocument()
  vi.unstubAllGlobals()
})
