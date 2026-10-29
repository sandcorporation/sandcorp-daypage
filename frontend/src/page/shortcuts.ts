import { useSyncExternalStore } from 'react'
import { api } from '../api/client'
import type { ToolKind } from './tools'

/**
 * 단축키(키 조합 → 동작). 사람마다 바꿀 수 있고, 바꾼 것은 계정에 저장해 어느 기기에서든 같다(아래 setKeymap).
 *
 * 키 조합은 'Mod+Shift+Z'처럼 쓴다. Mod는 Ctrl(맥은 ⌘), 끝은 눌린 자판 자리(KeyboardEvent.code)다:
 * 글자는 'P', 숫자는 '0', 나머지는 code 그대로('Equal', 'Delete'). 한글 입력 중에도 같은 자리를 누르면
 * 같은 단축키가 되도록 key(글자 'ㅔ')가 아니라 자리를 본다.
 */
export type ShortcutAction =
  | ToolKind
  | 'undo'
  | 'redo'
  | 'delete'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomFit'
  | 'focus'
  | 'rotateCw'
  | 'rotateCcw'
  | 'mirror'
  | 'viewReset'
  | 'eyedropper'
  | 'help'

export type Keymap = Record<ShortcutAction, string[]>

export const SHORTCUT_GROUPS: { name: string; actions: { id: ShortcutAction; label: string }[] }[] = [
  {
    name: '도구',
    actions: [
      { id: 'pen', label: '펜' },
      { id: 'highlighter', label: '형광펜' },
      { id: 'paint', label: '채색' },
      { id: 'shape', label: '도형' },
      { id: 'text', label: '글씨' },
      { id: 'eraser', label: '지우개' },
      { id: 'select', label: '선택·이동' },
      { id: 'eyedropper', label: '스포이트' },
    ],
  },
  {
    name: '편집',
    actions: [
      { id: 'undo', label: '되돌리기' },
      { id: 'redo', label: '다시 하기' },
      { id: 'delete', label: '고른 것 지우기' },
    ],
  },
  {
    name: '보기',
    actions: [
      { id: 'zoomIn', label: '확대' },
      { id: 'zoomOut', label: '축소' },
      { id: 'zoomFit', label: '화면에 맞추기' },
      { id: 'focus', label: '집중 모드' },
      { id: 'rotateCw', label: '시계 방향으로 돌리기' },
      { id: 'rotateCcw', label: '반시계 방향으로 돌리기' },
      { id: 'mirror', label: '좌우 뒤집기' },
      { id: 'viewReset', label: '돌리기·뒤집기 원위치' },
      { id: 'help', label: '단축키 보기' },
    ],
  },
]

export const SHORTCUT_ACTIONS: ShortcutAction[] = SHORTCUT_GROUPS.flatMap((g) => g.actions.map((a) => a.id))

export const DEFAULT_KEYMAP: Keymap = {
  pen: ['P'],
  highlighter: ['H'],
  paint: ['B'],
  shape: ['S'],
  text: ['T'],
  eraser: ['E'],
  select: ['V'],
  eyedropper: ['I'],
  undo: ['Mod+Z'],
  redo: ['Mod+Shift+Z', 'Mod+Y'],
  delete: ['Delete', 'Backspace'],
  zoomIn: ['Equal', 'Shift+Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  zoomFit: ['0', 'Numpad0'],
  focus: ['F'],
  rotateCw: ['R'],
  rotateCcw: ['Shift+R'],
  mirror: ['M'],
  viewReset: ['Shift+0'],
  help: ['Shift+Slash'],
}

/** 따로 정할 수 없는 키: 하던 것 취소(Esc)·화면 옮기기(Space)·곡선 끝내기(Enter)·포커스 옮기기(Tab) */
const RESERVED = new Set(['Escape', 'Space', 'Enter', 'NumpadEnter', 'Tab'])
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock)$/

type KeyLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** 키 이벤트 → 키 조합. 보조키만 눌렸으면 null. */
export function comboOf(e: KeyLike): string | null {
  const key = keyName(e)
  if (!key) return null
  return `${e.ctrlKey || e.metaKey ? 'Mod+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${key}`
}

function keyName(e: KeyLike): string | null {
  const code = e.code === 'Unknown' ? '' : e.code
  if (code) {
    if (MODIFIER_CODES.test(code)) return null
    const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(code)
    return m ? (m[1] ?? m[2]) : code
  }
  // code가 비는 입력기(일부 화면 키보드): key로 짐작한다
  const key = e.key
  if (!key || key === 'Unidentified' || key === 'Process' || MODIFIER_CODES.test(key)) return null
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase()
  return key === ' ' ? 'Space' : key
}

/** 정할 수 없는 조합인지(보조키 없는 Esc·Space·Enter·Tab) */
export function isReserved(combo: string): boolean {
  return RESERVED.has(combo)
}

const KEY_LABELS: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: '⌫',
}

export function isMac(): boolean {
  try {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  } catch {
    return false
  }
}

/** 보이는 이름: 'Mod+Shift+Z' → 'Ctrl+Shift+Z'(맥은 '⌘⇧Z') */
export function comboLabel(combo: string, mac = isMac()): string {
  const parts = combo.split('+')
  const key = parts.pop()!
  const name = KEY_LABELS[key] ?? key.replace(/^Numpad(\d)$/, 'Num $1')
  if (mac) {
    const sym: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' }
    return parts.map((p) => sym[p] ?? p).join('') + name
  }
  return [...parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)), name].join('+')
}

/** 이 조합에 걸린 동작 */
export function actionFor(keymap: Keymap, combo: string): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((a) => keymap[a].includes(combo)) ?? null
}

/** 키 이벤트가 이 동작의 단축키인지 */
export function matches(keymap: Keymap, action: ShortcutAction, e: KeyLike): boolean {
  const combo = comboOf(e)
  return combo !== null && keymap[action].includes(combo)
}

/**
 * 동작의 단축키를 이 조합 하나로 바꾼다. 다른 동작이 쓰던 조합이면 그쪽에서 빼고, 뺀 동작을 알려 준다.
 * combo가 null이면 단축키를 끈다.
 */
export function assign(keymap: Keymap, action: ShortcutAction, combo: string | null): { keymap: Keymap; taken: ShortcutAction | null } {
  const taken = combo === null ? null : actionFor(keymap, combo)
  const next = { ...keymap, [action]: combo === null ? [] : [combo] }
  if (taken && taken !== action) next[taken] = keymap[taken].filter((c) => c !== combo)
  return { keymap: next, taken: taken === action ? null : taken }
}

/** 한 동작을 기본값으로. 기본 조합을 다른 동작이 쓰고 있으면 그쪽에서 뺀다. */
export function resetAction(keymap: Keymap, action: ShortcutAction): Keymap {
  const defaults = DEFAULT_KEYMAP[action]
  const next = { ...keymap, [action]: [...defaults] }
  for (const a of SHORTCUT_ACTIONS) {
    if (a !== action) next[a] = next[a].filter((c) => !defaults.includes(c))
  }
  return next
}

export function isDefault(keymap: Keymap, action: ShortcutAction): boolean {
  const a = keymap[action]
  const d = DEFAULT_KEYMAP[action]
  return a.length === d.length && a.every((c, i) => c === d[i])
}

const KEY = 'daypage:shortcuts'
const COMBO = /^(Mod\+)?(Alt\+)?(Shift\+)?[A-Za-z0-9]+$/

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * 바꾼 동작만 담은 값({동작: [키 조합]}) → 단축키 표. 나머지는 기본값이다.
 * 바꾼 조합이 (나중에 생긴) 기본값과 겹치면 바꾼 쪽이 이긴다. 모르는 동작·망가진 조합은 버린다.
 */
export function keymapFrom(raw: unknown): Keymap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_KEYMAP
  const obj = raw as Record<string, unknown>
  const changed = new Map<ShortcutAction, string[]>()
  for (const a of SHORTCUT_ACTIONS) {
    const v = obj[a]
    if (Array.isArray(v)) changed.set(a, [...new Set(v.filter((c): c is string => typeof c === 'string' && COMBO.test(c) && !isReserved(c)))])
  }
  const used = new Set([...changed.values()].flat())
  const keymap = {} as Keymap
  for (const a of SHORTCUT_ACTIONS) {
    keymap[a] = changed.get(a) ?? DEFAULT_KEYMAP[a].filter((c) => !used.has(c))
  }
  return keymap
}

/** 단축키 표 → 바꾼 동작만 담은 값(저장하는 모양) */
export function changesOf(keymap: Keymap): Partial<Keymap> {
  const changed: Partial<Keymap> = {}
  for (const a of SHORTCUT_ACTIONS) if (!isDefault(keymap, a)) changed[a] = keymap[a]
  return changed
}

/** 이 브라우저에 둔 사본을 읽는다. 계정 값을 받기 전에 바로 쓰려고 둔다. */
export function loadKeymap(storage: StorageLike | null = defaultStorage()): Keymap {
  try {
    const text = storage?.getItem(KEY)
    return text ? keymapFrom(JSON.parse(text)) : DEFAULT_KEYMAP
  } catch {
    return DEFAULT_KEYMAP
  }
}

export function saveKeymap(keymap: Keymap, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(changesOf(keymap)))
  } catch {
    // 저장할 수 없으면(시크릿 창, 저장소 차단) 계정 값만 쓴다.
  }
}

/*
 * 단축키를 쓰는 곳(노트 화면·도구 막대 힌트·끌기 취소)이 여럿이라 한곳에 두고 구독한다.
 * 진짜 값은 계정(/api/me/shortcuts)에 있어 어느 기기에서든 같다. 브라우저 사본은 계정 값이 오기 전까지 쓴다.
 */
let current: Keymap | null = null
// 이번 방문에서 사용자가 바꿨으면 늦게 온 계정 값으로 덮지 않는다
let changedHere = false
let fetched = false
// 저장 요청을 차례로 보낸다(늦게 보낸 것이 먼저 닿아 옛 값으로 덮이지 않게)
let saving: Promise<unknown> = Promise.resolve()
const listeners = new Set<() => void>()

function publish(next: Keymap) {
  current = next
  saveKeymap(next)
  listeners.forEach((l) => l())
}

export function getKeymap(): Keymap {
  return (current ??= loadKeymap())
}

/** 단축키를 바꾸고 계정에 저장한다. 계정에 저장하지 못하면 false(이 브라우저에는 남는다). */
export function setKeymap(next: Keymap): Promise<boolean> {
  changedHere = true
  publish(next)
  const body = JSON.stringify(changesOf(next))
  const done = saving.then(() => api('/api/me/shortcuts', { method: 'PUT', body })).then(
    () => true,
    () => false,
  )
  saving = done
  return done
}

/** 계정에 둔 단축키를 한 번 받아 온다(노트를 열 때). 실패하면 브라우저 사본을 그대로 쓴다. */
export async function fetchKeymap(): Promise<void> {
  if (fetched) return
  fetched = true
  try {
    const raw = await api<unknown>('/api/me/shortcuts')
    if (!changedHere) publish(keymapFrom(raw))
  } catch {
    fetched = false
  }
}

/** 시험용: 모듈 상태를 처음으로 */
export function resetKeymapStore(): void {
  current = null
  changedHere = false
  fetched = false
  saving = Promise.resolve()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useKeymap(): Keymap {
  return useSyncExternalStore(subscribe, getKeymap)
}

/** 도구 막대 풍선 도움말에 붙이는 첫 단축키: ' (P)'. 없으면 빈 문자열. */
export function keyHint(keymap: Keymap, action: ShortcutAction): string {
  const first = keymap[action][0]
  return first ? ` (${comboLabel(first)})` : ''
}
