import { api } from '../api/client'

/** 로그인 전·참여 전에 보이는 노트 정보 */
export type Preview = { name: string; online: number; isFull: boolean }

export const fetchPreview = (noteId: string) => api<Preview>(`/api/notes/${noteId}/preview`)

/** 정원이 차서(note_full) 못 들어온 사람의 초대 화면에 쓸 값. 미리보기를 못 받아도 정원 참은 보인다. */
export const fetchFullPreview = (noteId: string): Promise<Preview> =>
  fetchPreview(noteId).catch(() => ({ name: '노트', online: 0, isFull: true }))
