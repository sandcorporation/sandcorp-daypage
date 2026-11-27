export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, code: string | undefined, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** 서버가 이유를 주지 않은 실패의 문구. 상태 글(statusText)은 영어이고 HTTP/2에서는 비어 있어 쓰지 않는다. */
function defaultMessage(status: number): string {
  return status >= 500 ? '서버에 문제가 생겨 하지 못했어요. 잠시 뒤 다시 해 주세요.' : '요청을 처리하지 못했어요.'
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
    let reason: unknown
    try {
      const body = await res.json()
      code = body.code
      reason = body.detail ?? body.message
    } catch {
      // 본문이 JSON이 아니면 서버가 준 이유가 없다
    }
    throw new ApiError(res.status, code, typeof reason === 'string' && reason ? reason : defaultMessage(res.status))
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('Content-Type') ?? ''
  if (type.includes('application/json')) return (await res.json()) as T
  return (await res.arrayBuffer()) as T
}
