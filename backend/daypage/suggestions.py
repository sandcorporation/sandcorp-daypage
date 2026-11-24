"""건의 상태 바꾸기와 디스코드 알림.

새 건의가 들어오거나 건의가 '검토 중'·'반영함'이 되면 운영 채널(디스코드 웹훅)에 알린다.
상태는 운영 페이지(사람)나 관리 명령 suggestion_status(건의 자동 처리 워커)가 바꾼다.
알림은 커밋 뒤 Celery로 보내 요청을 붙잡지 않고, 보내지 못해도 건의 저장에는 영향이 없다.
같은 본문을 둘째 알림 목적지(SUGGESTION_NOTICE_WEBHOOK, 디스코드와 같은 {"content": …} 꼴)에도 보낸다.
두 주소가 다 없으면 아무것도 보내지 않고, 한쪽만 있으면 그쪽에만 보낸다.
디스코드는 한 번만 보낸다. 둘째 알림 목적지가 다시 보낼 만한 실패(연결 오류·타임아웃·5xx·429)를 내면
처음 만든 본문 그대로 그 목적지에만 Celery로 다시 보낸다(NOTICE_RETRY_DELAYS 간격).
"""

import logging
from typing import Literal

import httpx
from django.conf import settings
from django.db import transaction

from .models import NoteMember, Suggestion

log = logging.getLogger(__name__)

# 알리는 상태 바뀜. '안 함'·'새 건의로 되돌림'은 알리지 않는다.
ALERT_STATUSES = {Suggestion.Status.REVIEWING, Suggestion.Status.DONE}
# 디스코드 메시지 한도는 2000자. 머리글·덧붙임을 빼고 본문은 이만큼만 옮긴다.
QUOTE_LIMIT = 1500
# 건의에 함께 남기는 화면 상태: 평평한 짧은 값만, 이만큼까지
CONTEXT_MAX_KEYS = 40
CONTEXT_KEY_LIMIT = 40
CONTEXT_VALUE_LIMIT = 300
# 디스코드 알림에 옮기는 화면 상태 한 줄의 길이. 브라우저 정보(userAgent)는 길어서 뺀다.
CONTEXT_LINE_LIMIT = 400


def clean_context(raw: object) -> dict:
    """화면이 보낸 상태에서 남길 것만 고른다: 짧은 이름에 문자열·수·참거짓·null 값만, 긴 글은 자른다."""
    if not isinstance(raw, dict):
        return {}
    kept: dict = {}
    for key, value in raw.items():
        if len(kept) >= CONTEXT_MAX_KEYS:
            break
        if not isinstance(key, str) or not key or len(key) > CONTEXT_KEY_LIMIT:
            continue
        if isinstance(value, str):
            kept[key] = value[:CONTEXT_VALUE_LIMIT]
        elif value is None or isinstance(value, (bool, int, float)):
            kept[key] = value
    return kept


def _context_line(context: dict) -> str:
    def show(v: object) -> str:
        return "null" if v is None else str(v).lower() if isinstance(v, bool) else str(v)

    line = " · ".join(f"{k}={show(v)}" for k, v in sorted(context.items()) if k != "userAgent")
    if len(line) > CONTEXT_LINE_LIMIT:
        line = line[:CONTEXT_LINE_LIMIT] + "…"
    return f"🔧 {line}" if line else ""


def change_status(s: Suggestion, status: str, note: str = "") -> bool:
    """상태를 바꾸고, 알릴 상태로 바뀌었으면 알림을 예약한다(note는 알림 끝 한 줄). 바뀌었는지 돌려준다."""
    if s.status == status:
        return False
    s.status = status
    s.save(update_fields=["status"])
    if status in ALERT_STATUSES:
        announce(s.id, status, note)
    return True


def announce(suggestion_id: int, event: str, note: str = "") -> None:
    """커밋된 뒤 알림을 보낸다. event는 'new' 또는 바뀐 상태."""
    if not _destinations():
        return
    from .tasks import send_suggestion_alert

    transaction.on_commit(lambda: send_suggestion_alert.delay(suggestion_id, event, note))


def _quote(text: str) -> str:
    if len(text) > QUOTE_LIMIT:
        text = text[:QUOTE_LIMIT] + "…"
    return "\n".join(f"> {line}" if line else ">" for line in text.splitlines())


def message(s: Suggestion, event: str, note: str = "") -> str:
    """디스코드에 보낼 글. 건의 원문은 인용으로 옮긴다."""
    nickname = ""
    if s.note_id and s.user_id:
        nickname = NoteMember.objects.filter(note_id=s.note_id, user_id=s.user_id).values_list("nickname", flat=True).first() or ""
    who = f" · {nickname}" if nickname else ""
    if event == "new":
        head = f"📮 **새 건의 #{s.id}**{who}"
    elif event == Suggestion.Status.REVIEWING:
        head = f"🔎 **건의 #{s.id} 검토 중**{who}"
    elif event == Suggestion.Status.DONE:
        head = f"✅ **건의 #{s.id} 반영함**{who}"
    else:
        head = f"건의 #{s.id} · {Suggestion.Status(event).label}{who}"
    parts = [head, _quote(s.text)]
    if event == "new" and (line := _context_line(s.context or {})):
        parts.append(line)
    if note:
        parts.append(note.strip()[:300])
    return "\n".join(parts)


# 둘째 알림 목적지는 디스코드(10초)보다 오래 기다리지 않는다.
NOTICE_TIMEOUT = 5
NOTICE_NAME = "둘째 알림 목적지"
# 둘째 알림 목적지를 다시 보낼 간격(초). 길이가 최대 재시도 횟수다.
NOTICE_RETRY_DELAYS = (30, 120, 480, 1800)

# 보낸 결과: 성공, 다시 보낼 만한 실패(연결 오류·타임아웃·5xx·429), 다시 보내도 소용없는 실패(그 밖의 4xx 등)
Outcome = Literal["ok", "retry", "fail"]
Payload = dict[str, object]


def _destinations() -> list[tuple[str, str, float]]:
    """(로그에 쓸 이름, 주소, 타임아웃). 주소는 비밀값이라 로그에는 이름만 남긴다."""
    found = [
        ("디스코드", settings.DISCORD_SUGGESTION_WEBHOOK, 10),
        (NOTICE_NAME, settings.SUGGESTION_NOTICE_WEBHOOK, NOTICE_TIMEOUT),
    ]
    return [d for d in found if d[1]]


def _post(name: str, url: str, timeout: float, payload: Payload, suggestion_id: int, event: str) -> Outcome:
    try:
        res = httpx.post(url, json=payload, timeout=timeout)
    except httpx.HTTPError as exc:
        log.warning("건의 알림 실패(%s) #%s %s: %s", name, suggestion_id, event, exc.__class__.__name__)
        return "retry" if isinstance(exc, httpx.TransportError) else "fail"
    if res.status_code >= 300:
        log.warning("건의 알림 실패(%s) #%s %s: HTTP %s", name, suggestion_id, event, res.status_code)
        return "retry" if res.status_code >= 500 or res.status_code == 429 else "fail"
    return "ok"


def _schedule_notice_retry(suggestion_id: int, event: str, payload: Payload, attempt: int) -> None:
    """attempt번째 재시도를 예약한다(1부터). 예약이 안 되면 로그만 남긴다."""
    from .tasks import resend_suggestion_notice

    try:
        resend_suggestion_notice.apply_async(
            (suggestion_id, event, payload, attempt), countdown=NOTICE_RETRY_DELAYS[attempt - 1]
        )
    except Exception as exc:  # 브로커가 없어도 알림 실패가 호출한 쪽을 깨지 않게 한다
        log.error("건의 알림 재시도 예약 실패(%s) #%s %s: %s", NOTICE_NAME, suggestion_id, event, exc.__class__.__name__)


def send(suggestion_id: int, event: str, note: str = "") -> bool:
    """설정된 곳마다 따로 보낸다. 한쪽이 실패해도 다른 쪽은 가고, 예외를 던지지 않는다(로그만).

    둘째 알림 목적지가 다시 보낼 만한 실패를 내면 그곳에만 재시도를 예약한다.
    모든 곳에 보냈으면 True.
    """
    destinations = _destinations()
    s = Suggestion.objects.filter(pk=suggestion_id).first()
    if not destinations or s is None:
        return False
    # 건의 글은 사용자가 쓴 것이다. @everyone 같은 멘션이 울리지 않게 막는다.
    payload: Payload = {"content": message(s, event, note), "allowed_mentions": {"parse": []}}
    results = []
    for name, url, timeout in destinations:
        outcome = _post(name, url, timeout, payload, suggestion_id, event)
        if name == NOTICE_NAME and outcome == "retry":
            _schedule_notice_retry(suggestion_id, event, payload, 1)
        results.append(outcome == "ok")
    return all(results)


def resend_notice(suggestion_id: int, event: str, payload: Payload, attempt: int) -> bool:
    """둘째 알림 목적지에만 같은 본문을 다시 보낸다(attempt번째 재시도). 또 실패하면 다음 재시도를 예약하고,
    다 써도 못 보냈으면 error로 남긴다. 보냈으면 True.
    """
    url = settings.SUGGESTION_NOTICE_WEBHOOK
    if not url:
        return False
    outcome = _post(NOTICE_NAME, url, NOTICE_TIMEOUT, payload, suggestion_id, event)
    if outcome == "retry":
        if attempt < len(NOTICE_RETRY_DELAYS):
            _schedule_notice_retry(suggestion_id, event, payload, attempt + 1)
        else:
            log.error("건의 알림 재시도를 다 써도 못 보냄(%s) #%s %s", NOTICE_NAME, suggestion_id, event)
    return outcome == "ok"
