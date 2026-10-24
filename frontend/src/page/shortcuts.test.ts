// @vitest-environment node
import {
  actionFor,
  assign,
  comboLabel,
  comboOf,
  DEFAULT_KEYMAP,
  isDefault,
  loadKeymap,
  resetAction,
  saveKeymap,
} from './shortcuts'

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}, k = '') => ({
  code,
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

function memory(initial?: unknown) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set('daypage:shortcuts', JSON.stringify(initial))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

describe('키 조합 읽기', () => {
  test('글자는 자판 자리로 읽어 한글 입력 중에도 같은 단축키가 된다', () => {
    expect(comboOf(key('KeyP', {}, 'ㅔ'))).toBe('P')
    expect(comboOf(key('KeyZ', { metaKey: true, shiftKey: true }, 'z'))).toBe('Mod+Shift+Z')
    expect(comboOf(key('KeyZ', { ctrlKey: true }))).toBe('Mod+Z')
    expect(comboOf(key('Digit0'))).toBe('0')
    expect(comboOf(key('Equal', { shiftKey: true }, '+'))).toBe('Shift+Equal')
  })

  test('보조키만 누르면 조합이 아니다', () => {
    expect(comboOf(key('ShiftLeft', { shiftKey: true }, 'Shift'))).toBeNull()
    expect(comboOf(key('MetaRight', { metaKey: true }, 'Meta'))).toBeNull()
  })

  test('code가 비면 key로 짐작한다', () => {
    expect(comboOf(key('', {}, 'e'))).toBe('E')
    expect(comboOf(key('', {}, 'Process'))).toBeNull()
  })

  test('보이는 이름은 Ctrl(맥은 기호)로', () => {
    expect(comboLabel('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z')
    expect(comboLabel('Mod+Shift+Z', true)).toBe('⌘⇧Z')
    expect(comboLabel('Shift+Equal', false)).toBe('Shift+=')
    expect(comboLabel('Numpad0', false)).toBe('Num 0')
  })
})

describe('단축키 바꾸기', () => {
  test('기본 단축키는 서로 겹치지 않는다', () => {
    const all = Object.values(DEFAULT_KEYMAP).flat()
    expect(new Set(all).size).toBe(all.length)
  })

  test('다른 동작이 쓰던 키를 붙이면 그쪽에서 빼고 알려 준다', () => {
    const { keymap, taken } = assign(DEFAULT_KEYMAP, 'eraser', 'P')
    expect(keymap.eraser).toEqual(['P'])
    expect(keymap.pen).toEqual([])
    expect(taken).toBe('pen')
    expect(actionFor(keymap, 'P')).toBe('eraser')
    expect(actionFor(keymap, 'E')).toBeNull()
  })

  test('자기 키를 다시 붙이면 뺀 동작이 없다. null이면 끈다', () => {
    expect(assign(DEFAULT_KEYMAP, 'redo', 'Mod+Y')).toEqual({ keymap: { ...DEFAULT_KEYMAP, redo: ['Mod+Y'] }, taken: null })
    expect(assign(DEFAULT_KEYMAP, 'focus', null).keymap.focus).toEqual([])
  })

  test('기본값으로 되돌리면 그 키를 가져간 동작에서 다시 뺀다', () => {
    const moved = assign(DEFAULT_KEYMAP, 'eraser', 'P').keymap
    const back = resetAction(moved, 'pen')
    expect(back.pen).toEqual(['P'])
    expect(back.eraser).toEqual([])
    expect(isDefault(back, 'pen')).toBe(true)
  })
})

describe('저장', () => {
  test('바꾼 동작만 저장하고, 읽을 때 나머지는 기본값', () => {
    const storage = memory()
    saveKeymap(assign(DEFAULT_KEYMAP, 'eraser', 'P').keymap, storage)
    expect(JSON.parse(storage.data.get('daypage:shortcuts')!)).toEqual({ eraser: ['P'], pen: [] })
    expect(loadKeymap(storage)).toEqual({ ...DEFAULT_KEYMAP, eraser: ['P'], pen: [] })
  })

  test('바꾼 키가 기본값과 겹치면 바꾼 쪽이 이긴다(나중에 기본값이 늘어도)', () => {
    expect(loadKeymap(memory({ focus: ['P'] }))).toMatchObject({ focus: ['P'], pen: [] })
  })

  test('망가진 값·모르는 동작·정해진 키는 버린다', () => {
    expect(loadKeymap(memory({ pen: ['Escape', 42, 'Mod+K'], nope: ['X'] }))).toEqual({ ...DEFAULT_KEYMAP, pen: ['Mod+K'] })
    expect(loadKeymap({ getItem: () => '{', setItem: () => {} })).toEqual(DEFAULT_KEYMAP)
    expect(loadKeymap(null)).toEqual(DEFAULT_KEYMAP)
  })
})
