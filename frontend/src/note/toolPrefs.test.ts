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
  saveToolPrefs({ tool: 'text', ink: '#E0603A', widthLevel: 2, font: 'myeongjo' }, storage)
  expect(loadToolPrefs(storage)).toEqual({ tool: 'text', ink: '#E0603A', widthLevel: 2, font: 'myeongjo' })
})

test('저장된 값이 없으면 기본값', () => {
  expect(loadToolPrefs(memoryStorage())).toEqual(DEFAULT_TOOL_PREFS)
})

test('모르는 값·깨진 값은 그 항목만 기본값으로 바꾼다', () => {
  const storage = memoryStorage({
    'daypage:tool-prefs': JSON.stringify({ tool: 'laser', ink: '#123456', widthLevel: 7, font: 'gaegu' }),
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
