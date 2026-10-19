export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
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
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.detail ?? message
    } catch {
      // 본문이 JSON이 아니면 상태 텍스트
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

export type Me = { authenticated: boolean; isStaff: boolean }

export type Stats = {
  totals: { users: number; notes: number }
  today: { date: string; signups: number; notes: number; visitors: number }
  daily: { date: string; signups: number; notes: number; activeNotes: number; participants: number | null }[]
  hourly: { hour: number; signups: number; notes: number; lastVisits: number }[]
  suggestions: { new: number }
  online: { connections: number; users: number; waiting: number; capacity: number | null }
}

export type SuggestionStatus = 'new' | 'reviewing' | 'done' | 'declined'

export type Suggestion = {
  id: number
  text: string
  status: SuggestionStatus
  createdAt: string
  userId: number | null
  noteId: string | null
  noteName: string | null
}

export type NoteRow = {
  id: string
  name: string
  createdAt: string
  ownerId: number
  memberCount: number
  memberLimit: number | null
  pageCount: number
  lastVisitedAt: string | null
  todayBytes: number
}

export type UserRow = {
  id: number
  createdAt: string
  ownedNotes: number
  memberships: number
  suggestions: number
  lastVisitedAt: string | null
  isStaff: boolean
}
