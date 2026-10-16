import { describe, expect, test } from 'vitest'
import { bundleOf } from './useNewVersion'

describe('새 버전 확인', () => {
  test('index.html에서 앱 번들 이름을 찾는다', () => {
    const html = '<script type="module" crossorigin src="/assets/index-DRMgjDsh.js"></script><link href="/assets/index-Ab_1.css">'
    expect(bundleOf(html)).toBe('/assets/index-DRMgjDsh.js')
  })

  test('번들이 없으면(개발 서버) null', () => {
    expect(bundleOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull()
  })
})
