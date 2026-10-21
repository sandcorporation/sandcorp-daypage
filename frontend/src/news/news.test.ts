// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { NEWS, loadSeen, markSeen, unreadIds, type NewsEntry } from './news'

const entries: NewsEntry[] = [
  { id: 'c', date: '10월 19일', items: [{ kind: 'new', text: 'c' }] },
  { id: 'b', date: '10월 17일', items: [{ kind: 'fix', text: 'b' }] },
  { id: 'a', date: '10월 16일', items: [{ kind: 'start', text: 'a' }] },
]

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('새 소식', () => {
  test('마지막으로 본 소식보다 새로운 것만 처음 보는 소식이다', () => {
    expect(unreadIds(entries, 'b')).toEqual(['c'])
    expect(unreadIds(entries, 'c')).toEqual([])
  })

  test('한 번도 열어 보지 않았으면 맨 위 소식 하나만 새 소식으로 친다(처음 온 사람에게 전부 새것이라 하지 않는다)', () => {
    expect(unreadIds(entries, null)).toEqual(['c'])
  })

  test('목록에서 사라진 소식을 봤다고 기록돼 있으면 맨 위 하나만 새것으로 친다', () => {
    expect(unreadIds(entries, 'gone')).toEqual(['c'])
  })

  test('열어 보면 맨 위 소식까지 본 것으로 저장한다(저장소를 못 써도 깨지지 않는다)', () => {
    const storage = memory()
    expect(loadSeen(storage)).toBeNull()
    markSeen(entries, storage)
    expect(loadSeen(storage)).toBe('c')
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadSeen(broken)).toBeNull()
    expect(() => markSeen(entries, broken)).not.toThrow()
  })

  test('실제 목록: id가 겹치지 않고 항목이 비어 있지 않다', () => {
    expect(new Set(NEWS.map((n) => n.id)).size).toBe(NEWS.length)
    for (const n of NEWS) expect(n.items.length).toBeGreaterThan(0)
  })
})
