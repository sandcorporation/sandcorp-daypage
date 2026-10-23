"""건의 상태 바꾸기와 디스코드 알림.

새 건의가 들어오거나 건의가 '검토 중'·'반영함'이 되면 운영 채널(디스코드 웹훅)에 알린다.
상태는 운영 페이지(사람)나 관리 명령 suggestion_status(건의 자동 처리 워커)가 바꾼다.
알림은 커밋 뒤 Celery로 보내 요청을 붙잡지 않고, 보내지 못해도 건의 저장에는 영향이 없다.
웹훅 주소(DISCORD_SUGGESTION_WEBHOOK)가 없으면 아무것도 보내지 않는다.
"""

import logging

import httpx
from django.conf import settings
from django.db import transaction

from .models import NoteMember, Suggestion

log = logging.getLogger(__name__)

# 알리는 상태 바뀜. '안 함'·'새 건의로 되돌림'은 알리지 않는다.
ALERT_STATUSES = {Suggestion.Status.REVIEWING, Suggestion.Status.DONE}
# 디스코드 메시지 한도는 2000자. 머리글·덧붙임을 빼고 본문은 이만큼만 옮긴다.
QUOTE_LIMIT = 1500


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
    if not settings.DISCORD_SUGGESTION_WEBHOOK:
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
    if note:
        parts.append(note.strip()[:300])
    return "\n".join(parts)


def send(suggestion_id: int, event: str, note: str = "") -> bool:
    """웹훅으로 보낸다. 실패해도 예외를 던지지 않는다(로그만)."""
    url = settings.DISCORD_SUGGESTION_WEBHOOK
    s = Suggestion.objects.filter(pk=suggestion_id).first()
    if not url or s is None:
        return False
    # 건의 글은 사용자가 쓴 것이다. @everyone 같은 멘션이 울리지 않게 막는다.
    payload = {"content": message(s, event, note), "allowed_mentions": {"parse": []}}
    try:
        res = httpx.post(url, json=payload, timeout=10)
    except httpx.HTTPError as exc:
        log.warning("건의 알림 실패 #%s %s: %s", suggestion_id, event, exc.__class__.__name__)
        return False
    if res.status_code >= 300:
        log.warning("건의 알림 실패 #%s %s: HTTP %s", suggestion_id, event, res.status_code)
        return False
    return True
