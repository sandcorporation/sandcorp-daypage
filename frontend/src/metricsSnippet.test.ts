import { describe, expect, test } from 'vitest'
import { injectMetricsSnippet } from '../metricsSnippet'

const html = '<html><head><title>x</title></head><body></body></html>'
const url = 'https://metrics.sandcorp.co.kr/m.js'

describe('메트릭 스니펫', () => {
  test('env가 있으면 head 끝에 태그가 들어간다', () => {
    const out = injectMetricsSnippet(html, url)
    expect(out).toContain(`<script defer src="${url}" data-site="daypage"></script>\n  </head>`)
  })
  test.each([undefined, '', '   '])('env가 비면(%j) 태그가 없다', (v) => {
    expect(injectMetricsSnippet(html, v)).toBe(html)
  })
})
