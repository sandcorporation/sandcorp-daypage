// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url))
const html = read('../index.html').toString('utf8')

function metaContent(attr: 'name' | 'property', key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`))
  return tag?.[1]
}

describe('링크 공유 카드 메타', () => {
  const expected: Array<['name' | 'property', string]> = [
    ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:type'],
    ['property', 'og:url'], ['property', 'og:site_name'], ['property', 'og:locale'],
    ['property', 'og:image'], ['property', 'og:image:width'], ['property', 'og:image:height'],
    ['property', 'og:image:alt'], ['name', 'twitter:card'], ['name', 'twitter:title'],
    ['name', 'twitter:description'], ['name', 'twitter:image'], ['name', 'description'],
  ]
  test.each(expected)('%s %s 가 있다', (attr, key) => {
    expect(metaContent(attr, key)).toBeTruthy()
  })

  test('값이 약속과 같다', () => {
    expect(metaContent('property', 'og:type')).toBe('website')
    expect(metaContent('property', 'og:site_name')).toBe('Daypage')
    expect(metaContent('property', 'og:locale')).toBe('ko_KR')
    expect(metaContent('property', 'og:url')).toBe('https://daypage.sandcorp.co.kr/')
    expect(metaContent('property', 'og:image')).toBe('https://daypage.sandcorp.co.kr/og-image.png')
    expect(metaContent('name', 'twitter:image')).toBe('https://daypage.sandcorp.co.kr/og-image.png')
    expect(metaContent('name', 'twitter:card')).toBe('summary_large_image')
    expect(metaContent('property', 'og:image:width')).toBe('1200')
    expect(metaContent('property', 'og:image:height')).toBe('630')
  })

  test('모든 경로가 같은 HTML을 받으므로 노트별 값(제목·내용·링크)은 메타에 없다', () => {
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).not.toMatch(/\{\{|\$\{|%[A-Z_]+%/) // 서버 렌더링 자리표시가 없다
    expect(head).not.toMatch(/\/note\//)
  })

  test('카드 이미지는 1200×630 PNG, 수백 KB 안', () => {
    const png = read('../public/og-image.png')
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    expect(png.length).toBeLessThan(500 * 1024)
  })
})
