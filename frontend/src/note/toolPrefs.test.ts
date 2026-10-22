// @vitest-environment node
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
  const prefs = { tool: 'shape', ink: '#E0603A', widthLevel: 2, customWidth: 18, font: 'myeongjo', brush: 'brushpen', shape: 'curve', pressure: false, penOnly: 'on', eraserLevel: 0, eraserWidth: 30, paintLevel: 1, paintWidth: null, paintOpacity: 0.6, paintSoft: false } as const
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

test('지우개 크기도 단계와 px로 기억한다', () => {
  const storage = memoryStorage()
  saveToolPrefs({ ...DEFAULT_TOOL_PREFS, eraserLevel: 2, eraserWidth: 30 }, storage)
  expect(loadToolPrefs(storage)).toMatchObject({ eraserLevel: 2, eraserWidth: 30 })
  expect(loadToolPrefs(memoryStorage({ 'daypage:tool-prefs': JSON.stringify({ eraserLevel: 9, eraserWidth: 'big' }) }))).toMatchObject({ eraserLevel: 1, eraserWidth: null })
})

test('채색 붓 설정(굵기 단계·px·불투명도·부드러움)을 기억하고 범위를 맞춘다', () => {
  const storage = memoryStorage()
  saveToolPrefs({ ...DEFAULT_TOOL_PREFS, tool: 'paint', paintLevel: 2, paintWidth: 180, paintOpacity: 0.3, paintSoft: true }, storage)
  expect(loadToolPrefs(storage)).toMatchObject({ tool: 'paint', paintLevel: 2, paintWidth: 180, paintOpacity: 0.3, paintSoft: true })
  const bad = loadToolPrefs(memoryStorage({ 'daypage:tool-prefs': JSON.stringify({ paintWidth: 999, paintOpacity: 7, paintSoft: 'yes' }) }))
  expect(bad).toMatchObject({ paintWidth: 200, paintOpacity: 1, paintSoft: false })
})
