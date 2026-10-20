import { describe, expect, test } from 'vitest'
import { DEFAULT_PAPER, normalizePaper, paperStyle, PAPER_COLORS } from './paper'

describe('노트 종이', () => {
  test('모르는 값·빠진 값은 기본 줄 노트로 채운다', () => {
    expect(normalizePaper(undefined)).toEqual(DEFAULT_PAPER)
    expect(normalizePaper({ pattern: 'stars', margin: 'yes', color: 'pink' })).toEqual(DEFAULT_PAPER)
    expect(normalizePaper({ pattern: 'dot' })).toEqual({ ...DEFAULT_PAPER, pattern: 'dot' })
  })

  test('줄 노트(기본)는 지금까지와 같은 32 간격 줄과 왼쪽 여백 선', () => {
    const s = paperStyle(DEFAULT_PAPER)
    expect(s.backgroundColor).toBe(PAPER_COLORS.white.ground)
    expect(s.backgroundImage).toContain('linear-gradient(90deg')
    expect(s.backgroundSize).toContain('100% 32px')
  })

  test('무지에 여백 선을 끄면 무늬가 없다', () => {
    expect(paperStyle({ pattern: 'blank', margin: false, color: 'cream' })).toEqual({
      backgroundColor: PAPER_COLORS.cream.ground,
      backgroundImage: 'none',
      backgroundSize: undefined,
      backgroundPosition: undefined,
    })
  })

  test('모눈은 가로·세로 줄, 점은 점 무늬', () => {
    expect(paperStyle({ pattern: 'grid', margin: false, color: 'white' }).backgroundImage?.match(/linear-gradient/g)).toHaveLength(2)
    expect(paperStyle({ pattern: 'dot', margin: false, color: 'white' }).backgroundImage).toContain('radial-gradient')
  })
})
