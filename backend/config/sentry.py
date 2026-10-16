"""오류 수집(GlitchTip, Sentry 호환)."""

import sentry_sdk


def init_sentry(dsn: str, *, debug: bool, environment: str) -> bool:
    """DSN이 있고 DEBUG가 꺼졌을 때(운영)만 켠다. 로컬·테스트의 오류는 보내지 않는다. 켰으면 True."""
    if not dsn or debug:
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        # 쿠키·IP 같은 개인 정보는 보내지 않는다.
        send_default_pii=False,
        # GlitchTip은 오류만 본다. 성능 추적은 끈다.
        traces_sample_rate=0,
    )
    return True
