/** 넓은 화면에서 도구 막대를 붙일 가장자리. 사람마다·기기마다 다른 편의 설정이라 브라우저에만 둔다. */
export type ToolbarDock = 'left' | 'right' | 'top' | 'bottom'

export const TOOLBAR_DOCKS: ToolbarDock[] = ['left', 'right', 'top', 'bottom']
const DEFAULT_DOCK: ToolbarDock = 'left'
const KEY = 'daypage:toolbar-dock'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadToolbarDock(storage: StorageLike | null = defaultStorage()): ToolbarDock {
  try {
    const v = storage?.getItem(KEY)
    return TOOLBAR_DOCKS.includes(v as ToolbarDock) ? (v as ToolbarDock) : DEFAULT_DOCK
  } catch {
    return DEFAULT_DOCK
  }
}

export function saveToolbarDock(dock: ToolbarDock, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, dock)
  } catch {
    // 저장할 수 없으면 이번 방문 동안만 기억한다.
  }
}

/** 화면 위 한 점에서 가장 가까운 가장자리. 화면 비율과 상관없게 폭·높이에 대한 상대 거리로 견준다. */
export function dockAt(point: { x: number; y: number }, view: { width: number; height: number }): ToolbarDock {
  const x = point.x / view.width
  const y = point.y / view.height
  const distances: [ToolbarDock, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ]
  return distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0]
}
