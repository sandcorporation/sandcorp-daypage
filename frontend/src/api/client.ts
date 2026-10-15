export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, code: string | undefined, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('X-CSRFToken', csrfToken())
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers })
  if (!res.ok) {
    let code: string | undefined
    let message = res.statusText
    try {
      const body = await res.json()
      code = body.code
      message = body.detail ?? body.message ?? message
    } catch {
      // 본문이 JSON이 아니면 상태 텍스트를 쓴다
    }
    throw new ApiError(res.status, code, message)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('Content-Type') ?? ''
  if (type.includes('application/json')) return (await res.json()) as T
  return (await res.arrayBuffer()) as T
}
