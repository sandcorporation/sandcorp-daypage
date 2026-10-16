import { api } from './api/client'

type ClientConfig = { sentryDsn: string | null; environment: string }
type SentryLike = { init: (options: Record<string, unknown>) => unknown }

/** 지금 화면이 불러온 번들 이름. 어느 배포에서 난 오류인지 구분하는 데 쓴다. */
function release(): string | undefined {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')
  return src?.match(/index-([\w-]+)\.js/)?.[1]
}

/**
 * 오류 수집(GlitchTip)을 켠다. DSN은 빌드에 넣지 않고 서버(/api/client-config)에서 받는다.
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
    release: release(),
    // 쿠키·IP 같은 개인 정보는 보내지 않는다. 성능 추적은 끈다.
    sendDefaultPii: false,
    tracesSampleRate: 0,
  })
  return true
}
