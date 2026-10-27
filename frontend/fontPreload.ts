import type { Plugin } from 'vite'

/**
 * 첫 화면(랜딩)에 꼭 쓰는 woff2만 먼저 받게 `<link rel="preload">`를 넣는다(#73).
 * 글꼴 파일 이름에는 빌드 때 해시가 붙으므로, 빌드 산출물(bundle)에서 이름으로 찾아 해시 경로를 적는다.
 * 목록은 랜딩을 열었을 때 실제로 요청되는 조각에서 골랐다(라틴 + 자주 쓰는 한글 조각 119·118).
 * 수십 개를 다 받지 않는다. 개발 서버에는 bundle이 없어 아무것도 넣지 않는다.
 */
const PRELOAD = [
  /^gothic-a1-latin-400-normal-.*\.woff2$/,
  /^gothic-a1-119-400-normal-.*\.woff2$/,
  /^gothic-a1-118-400-normal-.*\.woff2$/,
  /^nanum-pen-script-latin-400-normal-.*\.woff2$/,
  /^nanum-pen-script-118-400-normal-.*\.woff2$/,
]

export function fontPreload(): Plugin {
  return {
    name: 'daypage-font-preload',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return []
        const files = Object.keys(ctx.bundle)
        return PRELOAD.flatMap((re) => {
          const file = files.find((f) => re.test(f.replace(/^.*\//, '')))
          if (!file) return []
          return [
            {
              tag: 'link',
              attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${file}` },
              injectTo: 'head' as const,
            },
          ]
        })
      },
    },
  }
}
