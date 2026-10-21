import { DEFAULT_TOOL_PREFS, loadToolPrefs, saveToolPrefs } from './toolPrefs'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}

test('저장한 도구 설정을 다시 읽는다', () => {
  const storage = memoryStorage()
  const prefs = { tool: 'shape', ink: '#E0603A', widthLevel: 2, customWidth: 18, font: 'myeongjo', brush: 'brushpen', shape: 'curve', pressure: false, penOnly: 'on' } as const
  saveToolPrefs(prefs, storage)
  expect(loadToolPrefs(storage)).toEqual(prefs)
})

test('저장된 값이 없으면 기본값', () => {
  expect(loadToolPrefs(memoryStorage())).toEqual(DEFAULT_TOOL_PREFS)
})

test('모르는 값·깨진 값은 그 항목만 기본값으로 바꾼다', () => {
  const storage = memoryStorage({
    'daypage:tool-prefs': JSON.stringify({ tool: 'laser', ink: 'blue', widthLevel: 7, font: 'gaegu', brush: 'laser', shape: 'star', pressure: 'yes' }),
  })
  expect(loadToolPrefs(storage)).toEqual({ ...DEFAULT_TOOL_PREFS, font: 'gaegu' })
  expect(loadToolPrefs(memoryStorage({ 'daypage:tool-prefs': '{not json' }))).toEqual(DEFAULT_TOOL_PREFS)
})

test('저장소를 쓸 수 없는 환경(시크릿 창 등)에서도 깨지지 않는다', () => {
  const broken = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    },
  }
  expect(loadToolPrefs(broken)).toEqual(DEFAULT_TOOL_PREFS)
  expect(() => saveToolPrefs(DEFAULT_TOOL_PREFS, broken)).not.toThrow()
})

test('노트 색(#rrggbb)도 고른 잉크로 기억한다', () => {
  const storage = memoryStorage({ 'daypage:tool-prefs': JSON.stringify({ ink: '#16794f' }) })
  expect(loadToolPrefs(storage).ink).toBe('#16794f')
})

test('직접 정한 굵기는 1~80으로 맞추고, 숫자가 아니면 쓰지 않는다', () => {
  expect(loadToolPrefs(memoryStorage({ 'daypage:tool-prefs': JSON.stringify({ customWidth: 300 }) })).customWidth).toBe(80)
  expect(loadToolPrefs(memoryStorage({ 'daypage:tool-prefs': JSON.stringify({ customWidth: 'big' }) })).customWidth).toBeNull()
})
