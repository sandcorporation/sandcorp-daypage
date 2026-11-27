export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
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
    let reason: unknown
    try {
      const body = await res.json()
      reason = body.detail
    } catch {
      // 본문이 JSON이 아니면 서버가 준 이유가 없다
    }
    throw new ApiError(res.status, typeof reason === 'string' && reason ? reason : defaultMessage(res.status))
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('Content-Type') ?? ''
  if (!type.includes('application/json')) return (await res.text()) as T
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
  /** 보낼 때의 화면 상태(도구·펜 전용 모드·기기 등). 예전 건의는 비어 있다. */
  context?: Record<string, string | number | boolean | null>
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
  /** 운영자가 닫은 노트 */
  closed: boolean
}

export type UserRow = {
  id: number
  createdAt: string
  ownedNotes: number
  memberships: number
  suggestions: number
  lastVisitedAt: string | null
  isStaff: boolean
  /** 지금 정지 중 */
  suspended: boolean
}

/** 정지(until이 null이면 영구) */
export type Suspension = { until: string | null; reason: string }

export type NoteDetail = {
  id: string
  name: string
  createdAt: string
  ownerId: number
  memberLimit: number | null
  closed: { at: string; reason: string } | null
  /** 지금 쓰는 장의 키(`2026-10-21`, `2026-10-21-2`) */
  openPage: string
  sealHour: number
  members: { id: number; userId: number; nickname: string; color: string; joinedAt: string; lastVisitedAt: string }[]
  pages: { key: string; date: string; seq: number; participantCount: number; strokeCount: number }[]
}

export type UserDetail = {
  id: number
  createdAt: string
  isStaff: boolean
  suspension: Suspension | null
  notes: { id: string; name: string; nickname: string; isOwner: boolean; lastVisitedAt: string; closed: boolean }[]
}

export type LogRow = {
  id: number
  at: string
  staffId: number | null
  action: 'view_note' | 'view_page' | 'close_note' | 'reopen_note' | 'suspend_user' | 'unsuspend_user'
  noteId: string | null
  noteName: string | null
  targetUserId: number | null
  detail: string
}
