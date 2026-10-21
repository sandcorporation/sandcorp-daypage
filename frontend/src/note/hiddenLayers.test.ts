// @vitest-environment node
import { loadHiddenLayers, saveHiddenLayers } from './hiddenLayers'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

test('숨긴 레이어를 노트·날짜별로 기억한다', () => {
  const storage = memoryStorage()
  saveHiddenLayers('n1', '2026-10-16', new Set(['a', 'b']), storage)
  expect(loadHiddenLayers('n1', '2026-10-16', storage)).toEqual(new Set(['a', 'b']))
  expect(loadHiddenLayers('n1', '2026-10-17', storage)).toEqual(new Set())
  expect(loadHiddenLayers('n2', '2026-10-16', storage)).toEqual(new Set())
})

test('깨진 값이나 쓸 수 없는 저장소에서도 빈 목록으로 동작한다', () => {
  expect(loadHiddenLayers('n1', '2026-10-16', memoryStorage({ 'daypage:hidden-layers:n1:2026-10-16': '{x' }))).toEqual(new Set())
  const broken = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }
  expect(loadHiddenLayers('n1', '2026-10-16', broken)).toEqual(new Set())
  expect(() => saveHiddenLayers('n1', '2026-10-16', new Set(['a']), broken)).not.toThrow()
})
