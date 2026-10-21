// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { DEFAULT_PAPER, normalizePaper, paperPalette, paperStyle, PAPER_COLORS } from './paper'

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

describe('직접 고른 종이 색', () => {
  test('색 코드는 소문자로 받아들이고, 없앤 칠판은 흰 종이가 된다', () => {
    expect(normalizePaper({ color: '#FDE8EF' }).color).toBe('#fde8ef')
    expect(normalizePaper({ color: 'chalk' }).color).toBe('white')
    expect(normalizePaper({ color: '#fde8e' }).color).toBe('white')
  })

  test('밝은 색이면 무늬를 바탕보다 조금 어둡게, 어두운 색이면 조금 밝게 그린다', () => {
    const light = paperPalette('#fde8ef')
    expect(light.ground).toBe('#fde8ef')
    expect(luma(light.rule)).toBeLessThan(luma(light.ground))
    expect(luma(light.dot)).toBeLessThan(luma(light.rule))
    const dark = paperPalette('#203040')
    expect(luma(dark.rule)).toBeGreaterThan(luma(dark.ground))
  })

  test('기본 색은 정해 둔 색표를 그대로 쓴다', () => {
    expect(paperPalette('white')).toEqual(PAPER_COLORS.white)
    expect(paperStyle({ pattern: 'lined', margin: false, color: '#fde8ef' }).backgroundColor).toBe('#fde8ef')
  })
})

function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
