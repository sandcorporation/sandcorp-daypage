"""오류 수집(GlitchTip, Sentry 호환).

운영(DSN이 있고 DEBUG가 꺼짐)에서만 켠다. 원칙은 codemit `backend/core/observability.py`와
공용 지침(GlitchTip 연동 지침 1절)을 따른다.

- **release = 배포 커밋 sha 40자.** compose가 `SENTRY_RELEASE: ${SANDCORP_IMAGE_SHA:-}`로 넣는다
  (Jenkins `sandcorpDeploy`가 배포 스크립트에 주는 값, 롤백이면 직전 sha). 진단 세션이
  `git show <release>:<경로>`로 그때 코드를 본다. 비면 release 없이 보낸다.
- **보내지 않는 것**: 요청 본문(`max_request_body_size="never"`)·쿠키·자격 헤더, 스택 프레임의
  지역 변수(`include_local_variables=False`, 그리고 `scrub_secrets`가 한 번 더 지운다).
- **의도한 4xx 거절은 오류가 아니다**: `Http404`·`PermissionDenied`·`SuspiciousOperation`과
  `status_code`가 400~499인 예외(django-ninja `HttpError` 등)는 버린다(`drop_expected_error`).
- **`manage.py shell`에서 손으로 친 명령의 예외도 버린다**(앱 결함이 아니다). 다른 관리 명령은 보낸다 —
  `glitchtip_test`가 그 길로 연동을 확인한다.
- codemit에 있는 celery 브로커 재접속 소음 거르기는 가져오지 않았다: daypage 배포는 redis를
  다시 만들지 않는다(`deploy/deploy.sh`의 `up --no-recreate postgres redis`).
"""

from collections.abc import Callable
from typing import Literal, NotRequired, TypedDict

import sentry_sdk
from sentry_sdk.types import Event, Hint


class SentryOptions(TypedDict):
    """`sentry_sdk.init`에 넘기는 설정. 시험은 여기에 가짜 전송(transport)만 더해 켠다."""

    dsn: str
    environment: str
    release: str | None
    send_default_pii: bool
    traces_sample_rate: float
    include_local_variables: bool
    max_request_body_size: Literal["never"]
    before_send: Callable[[Event, Hint], Event | None]
    transport: NotRequired[object]


_SHELL_COMMAND_MODULE = "django.core.management.commands.shell"
_SHELL_COMMAND_PATH = "django/core/management/commands/shell.py"

#: 이벤트에서 지우는 요청 헤더(소문자). 프론트 `errorReporting.ts`의 `CREDENTIAL_HEADERS`와 같은 목록이다.
CREDENTIAL_HEADERS = frozenset({"cookie", "set-cookie", "authorization", "proxy-authorization", "x-csrftoken"})


def _status_code_of(exc: BaseException) -> int | None:
    """그 예외가 대신하는 HTTP 상태 코드. 없으면 None(=진짜 예외)."""
    status = getattr(exc, "status_code", None)
    return status if isinstance(status, int) else None


def _is_manage_shell_error(event: Event) -> bool:
    """예외 스택에 `manage.py shell` 명령 프레임이 있으면 True."""
    for value in (event.get("exception") or {}).get("values") or []:
        for frame in (value.get("stacktrace") or {}).get("frames") or []:
            if frame.get("module") == _SHELL_COMMAND_MODULE:
                return True
            for key in ("abs_path", "filename"):
                if str(frame.get(key) or "").replace("\\", "/").endswith(_SHELL_COMMAND_PATH):
                    return True
    return False


def drop_expected_error(event: Event, hint: Hint) -> Event | None:
    """의도한 4xx 거절·shell 예외면 버리고(None), 그 밖이면 그대로 둔다. 예외가 없는 이벤트(로그)는 그대로 둔다."""
    if _is_manage_shell_error(event):
        return None
    exc_info = hint.get("exc_info")
    if not exc_info:
        return event
    exc = exc_info[1]

    from django.core.exceptions import PermissionDenied, SuspiciousOperation
    from django.http import Http404

    if isinstance(exc, (Http404, PermissionDenied, SuspiciousOperation)):
        return None
    status = _status_code_of(exc)
    if status is not None and 400 <= status < 500:
        return None
    return event


def _drop_frame_vars(container: object) -> None:
    """`exception.values[]`·`threads.values[]`의 프레임에서 `vars`를 지운다."""
    values = container.get("values") if isinstance(container, dict) else None
    for value in values or ():
        for frame in ((value or {}).get("stacktrace") or {}).get("frames") or ():
            if isinstance(frame, dict):
                frame.pop("vars", None)


def scrub_secrets(event: Event) -> Event:
    """보내기 직전에 자격이 실릴 수 있는 자리를 지운다: 요청 쿠키·본문, 자격 헤더, 프레임 지역 변수."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("cookies", None)
        request.pop("data", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for name in list(headers):
                if str(name).lower() in CREDENTIAL_HEADERS:
                    del headers[name]
    _drop_frame_vars(event.get("exception"))
    _drop_frame_vars(event.get("threads"))
    return event


def before_send(event: Event, hint: Hint) -> Event | None:
    """SDK의 `before_send` — 의도한 거절은 버리고, 남은 것은 비밀을 지워 보낸다."""
    kept = drop_expected_error(event, hint)
    return None if kept is None else scrub_secrets(kept)


def sentry_options(dsn: str, *, environment: str, release: str = "") -> SentryOptions:
    return {
        "dsn": dsn,
        "environment": environment,
        "release": release.strip() or None,
        # 쿠키·IP 같은 개인 정보는 보내지 않는다.
        "send_default_pii": False,
        # GlitchTip은 오류만 본다. 성능 추적은 끈다.
        "traces_sample_rate": 0.0,
        # 프레임 지역 변수에 요청·토큰이 실릴 수 있다(codemit #590).
        "include_local_variables": False,
        "max_request_body_size": "never",
        "before_send": before_send,
    }


def init_sentry(dsn: str, *, debug: bool, environment: str, release: str = "") -> bool:
    """DSN이 있고 DEBUG가 꺼졌을 때(운영)만 켠다. 로컬·테스트의 오류는 보내지 않는다. 켰으면 True."""
    if not dsn or debug:
        return False
    sentry_sdk.init(**sentry_options(dsn, environment=environment, release=release))
    return True
