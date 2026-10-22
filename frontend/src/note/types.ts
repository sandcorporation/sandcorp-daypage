import type { Paper } from '../page/paper'

/** 장 하나의 자리. 같은 날짜에 둘 이상이면 seq로 구분하고 key는 '2026-10-21', '2026-10-21-2' 꼴 */
export type OpenPage = {
  key: string
  date: string
  seq: number
  openedAt: string
  dueAt: string
}

export type NoteDetail = {
  id: string
  name: string
  url: string
  isOwner: boolean
  /** 지금 쓰는 장. key로 방에 붙고 dueAt까지 남은 시간을 센다 */
  page: OpenPage
  /** 봉인 시각(KST 0~23시). 노트의 하루는 이 시각에 시작해 다음 날 이 시각에 끝난다 */
  sealHour: number
  serverNow: string
  me: { nickname: string; color: string }
  online: number
  memberCount: number
  memberLimit: number | null
  /** 노트 색(#rrggbb, 더한 순서) */
  colors: string[]
  /** 노트 종이(서버가 늘 준다. 옛 응답·시험용으로 빠질 수 있다) */
  paper?: Paper
}

export type Peer = {
  clientId: number
  nickname: string
  color: string
  cursor: { x: number; y: number } | null
  editingBoxId: string | null
  isMe: boolean
}
