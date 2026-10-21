/**
 * 펜 전용 모드: 펜(스타일러스)을 쓰는 동안 손가락은 그리지 않고 스크롤만 한다.
 * 손바닥이 종이에 닿아도 선이 생기지 않고, 손가락 하나로 페이지를 넘긴다(Procreate·GoodNotes 방식).
 */
export type PenOnlyMode = 'auto' | 'on' | 'off'

export const PEN_ONLY_MODES: { id: PenOnlyMode; name: string; desc: string }[] = [
  { id: 'auto', name: '자동', desc: '펜을 쓰면 손가락은 스크롤만 해요' },
  { id: 'on', name: '켬', desc: '손가락은 늘 스크롤만' },
  { id: 'off', name: '끔', desc: '손가락으로도 그려요' },
]

export const DEFAULT_PEN_ONLY: PenOnlyMode = 'auto'

export function isPenOnlyMode(v: unknown): v is PenOnlyMode {
  return PEN_ONLY_MODES.some((m) => m.id === v)
}

/** 지금 손가락이 그리지 않고 스크롤만 해야 하는지. penSeen은 이번 방문에서 펜 입력을 본 적이 있는지. */
export function fingerScrollsOnly(mode: PenOnlyMode, penSeen: boolean): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return penSeen
}
