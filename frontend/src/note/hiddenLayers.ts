/** 내 화면에서만 숨긴 레이어. 사람·기기마다 다른 화면 설정이라 브라우저에 노트·날짜별로 둔다. */

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const key = (noteId: string, date: string) => `daypage:hidden-layers:${noteId}:${date}`

export function loadHiddenLayers(noteId: string, date: string, storage: StorageLike | null = defaultStorage()): Set<string> {
  try {
    const raw = JSON.parse(storage?.getItem(key(noteId, date)) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveHiddenLayers(
  noteId: string,
  date: string,
  hidden: ReadonlySet<string>,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(key(noteId, date), JSON.stringify([...hidden]))
  } catch {
    // 저장할 수 없으면 이번 방문 동안만 기억한다.
  }
}
