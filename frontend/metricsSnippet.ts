import type { Plugin } from 'vite'

// 메트릭 스니펫(#51): VITE_METRICS_SNIPPET_URL이 비어 있지 않을 때만 head 끝에 스크립트 태그를 넣는다.
// 값이 없으면 태그 자체가 없다(빈 src 태그를 남기지 않는다). 운영 화면(admin)에는 쓰지 않는다.
export function metricsSnippetTag(url: string | undefined): string | null {
  const src = (url ?? '').trim()
  if (!src) return null
  const escaped = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<script defer src="${escaped}" data-site="daypage"></script>`
}

export function injectMetricsSnippet(html: string, url: string | undefined): string {
  const tag = metricsSnippetTag(url)
  return tag ? html.replace('</head>', `    ${tag}\n  </head>`) : html
}

export function metricsSnippet(url: string | undefined): Plugin {
  return { name: 'metrics-snippet', transformIndexHtml: (html) => injectMetricsSnippet(html, url) }
}
