import { api } from './api/client'

type ClientConfig = { sentryDsn: string | null; environment: string; release?: string | null }
type SentryLike = { init: (options: Record<string, unknown>) => unknown }

/** beforeSend가 손대는 이벤트 자리만 적은 모양(SDK 이벤트의 부분집합). */
export type ScrubbableEvent = {
  message?: string
  request?: { url?: string; cookies?: unknown; data?: unknown; headers?: Record<string, string> }
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
}

/** 이벤트에서 지우는 요청 헤더(소문자). 백엔드 `config/sentry.py`의 `CREDENTIAL_HEADERS`와 같은 목록이다. */
const CREDENTIAL_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-csrftoken'])

/** 토큰 모양 문자열: `Bearer …`, JWT, 32자 넘는 영숫자 덩어리(CSRF·세션 토큰 등). */
const TOKEN_LIKE = /Bearer\s+[\w.~+/=-]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b[A-Za-z0-9_-]{32,}\b/g
const FILTERED = '[Filtered]'

function scrubText<T extends string | undefined>(text: T): T {
  return (text === undefined ? text : text.replace(TOKEN_LIKE, FILTERED)) as T
}

/**
 * 보내기 직전에 자격이 실릴 수 있는 자리를 지운다: 요청 쿠키·본문, 자격 헤더, 그리고 메시지·예외 값·
 * 주소·브레드크럼에 섞인 토큰 모양 문자열.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const request = event.request
  if (request) {
    delete request.cookies
    delete request.data
    request.url = scrubText(request.url)
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (CREDENTIAL_HEADERS.has(name.toLowerCase())) delete request.headers[name]
      }
    }
  }
  event.message = scrubText(event.message)
  for (const value of event.exception?.values ?? []) value.value = scrubText(value.value)
  for (const crumb of event.breadcrumbs ?? []) {
    crumb.message = scrubText(crumb.message)
    if (typeof crumb.data?.url === 'string') crumb.data.url = scrubText(crumb.data.url)
  }
  return event
}

/** 지금 화면이 불러온 번들 이름. 서버가 release(배포 sha)를 안 줄 때 어느 배포인지 구분하는 데 쓴다. */
function bundleName(): string | undefined {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')
  return src?.match(/index-([\w-]+)\.js/)?.[1]
}

/**
 * 오류 수집(GlitchTip)을 켠다. DSN·release는 빌드에 넣지 않고 서버(/api/client-config)에서 받는다.
 * 운영에서만 DSN이 오고, 그때만 SDK를 따로 불러온다(로컬·DSN 없음이면 번들을 받지 않는다).
 * 켰으면 true. 설정을 못 받아도 앱은 그대로 돈다.
 */
export async function startErrorReporting(
  load: () => Promise<SentryLike> = () => import('@sentry/react'),
  fetchConfig: () => Promise<ClientConfig> = () => api<ClientConfig>('/api/client-config'),
): Promise<boolean> {
  let config: ClientConfig
  try {
    config = await fetchConfig()
  } catch {
    return false
  }
  if (!config.sentryDsn) return false
  const Sentry = await load()
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.environment,
    // 배포 커밋 sha(백엔드와 같은 release). 없으면 번들 이름으로 물러난다.
    release: config.release || bundleName(),
    // 쿠키·IP 같은 개인 정보는 보내지 않는다. 성능 추적은 끈다.
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  })
  return true
}
