export type NoteDetail = {
  id: string
  name: string
  url: string
  isOwner: boolean
  today: string
  nextMidnight: string
  serverNow: string
  me: { nickname: string; color: string }
  online: number
  memberCount: number
  memberLimit: number | null
}

export type Peer = {
  clientId: number
  nickname: string
  color: string
  cursor: { x: number; y: number } | null
  editingBoxId: string | null
  isMe: boolean
}
