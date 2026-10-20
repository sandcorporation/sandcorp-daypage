import { dockAt, loadToolbarDock, saveToolbarDock } from './toolbarDock'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

test('툴바 자리를 저장하고 다시 읽는다. 없거나 모르는 값이면 왼쪽', () => {
  const storage = memoryStorage()
  expect(loadToolbarDock(storage)).toBe('left')
  saveToolbarDock('top', storage)
  expect(loadToolbarDock(storage)).toBe('top')
  expect(loadToolbarDock(memoryStorage({ 'daypage:toolbar-dock': 'middle' }))).toBe('left')
  expect(loadToolbarDock(null)).toBe('left')
})

test('끌어 놓은 자리에서 가장 가까운 가장자리에 붙는다', () => {
  const view = { width: 1200, height: 800 }
  expect(dockAt({ x: 40, y: 400 }, view)).toBe('left')
  expect(dockAt({ x: 1180, y: 400 }, view)).toBe('right')
  expect(dockAt({ x: 600, y: 30 }, view)).toBe('top')
  expect(dockAt({ x: 600, y: 790 }, view)).toBe('bottom')
  // 가로세로 비율이 달라도 상대 거리로 견준다(가운데보다 조금 위면 위)
  expect(dockAt({ x: 600, y: 300 }, view)).toBe('top')
})
