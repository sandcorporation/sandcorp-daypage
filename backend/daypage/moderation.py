"""운영 조치: 노트 닫기, 사용자 정지, 노트에서 내보내기, 그리고 운영자 기록.

- 닫힌 노트: 지우지 않고, 다시 열 때까지 아무도 들어오거나 바꾸지 못한다.
- 정지된 사용자: 정지가 끝날 때까지(영구면 풀 때까지) 노트에 들어가거나 만들지 못한다. 로그인은 되어 사유를 본다.
- 내보낸 참여자: 그 노트에 다시 들어오지 못한다. 노트를 만든 사람이 다시 허용할 수 있다.

접속해 있던 사람은 바로 끊는다(consumers.py가 4410·4403·4411로 닫는다).
"""

import datetime as dt

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from . import clock
from .models import AdminLog, Note, NoteBan, NoteMember, User

# 정지 기간(일). None은 영구.
SUSPEND_DAYS = (1, 7, 30)
REASON_MAX = 200


class Blocked(Exception):
    """노트를 쓸 수 없는 까닭. code는 API·화면이 구분하는 값이다."""

    code = ""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class NoteClosed(Blocked):
    code = "note_closed"


class Suspended(Blocked):
    code = "suspended"


class Kicked(Blocked):
    code = "kicked"


def user_group(user_id: int) -> str:
    return f"user.{user_id}"


# ── 정지 ───────────────────────────────────────────────────────


def suspension(user: User, now: dt.datetime | None = None) -> dict | None:
    """지금 정지 중이면 {until(영구면 None), reason}."""
    if not getattr(user, "is_authenticated", False):
        return None
    if user.suspension_permanent:
        return {"until": None, "reason": user.suspension_reason}
    if user.suspended_until and user.suspended_until > (now or clock.now()):
        return {"until": user.suspended_until.isoformat(), "reason": user.suspension_reason}
    return None


def _suspension_text(s: dict) -> str:
    if s["until"] is None:
        return f"이용이 정지된 계정이에요. 사유: {s['reason']}"
    until = dt.datetime.fromisoformat(s["until"]).astimezone(clock.KST)
    return f"{until:%Y. %m. %d. %H:%M}까지 이용이 정지된 계정이에요. 사유: {s['reason']}"


def check_user(user: User) -> None:
    s = suspension(user)
    if s:
        raise Suspended(_suspension_text(s))


def suspend(staff: User, target: User, days: int | None, reason: str) -> dict:
    target.suspension_reason = reason
    target.suspension_permanent = days is None
    target.suspended_until = None if days is None else clock.now() + dt.timedelta(days=days)
    target.save(update_fields=["suspension_reason", "suspension_permanent", "suspended_until"])
    log(staff, "suspend_user", target_user_id=target.id, detail=f"{'영구' if days is None else f'{days}일'} · {reason}")
    transaction.on_commit(lambda: _send_group(user_group(target.id), {"type": "user.suspended"}))
    return suspension(target)


def unsuspend(staff: User, target: User) -> None:
    target.suspension_reason = ""
    target.suspension_permanent = False
    target.suspended_until = None
    target.save(update_fields=["suspension_reason", "suspension_permanent", "suspended_until"])
    log(staff, "unsuspend_user", target_user_id=target.id)


# ── 노트 닫기 ──────────────────────────────────────────────────


def closed(note: Note) -> dict | None:
    if note.closed_at is None:
        return None
    return {"at": note.closed_at.isoformat(), "reason": note.closed_reason}


def close_note(staff: User, note: Note, reason: str) -> None:
    note.closed_at = clock.now()
    note.closed_reason = reason
    note.save(update_fields=["closed_at", "closed_reason"])
    log(staff, "close_note", note=note, detail=reason)
    from .consumers import note_group

    note_id = note.id
    transaction.on_commit(lambda: _send_group(note_group(note_id), {"type": "note.closed"}))


def reopen_note(staff: User, note: Note) -> None:
    note.closed_at = None
    note.closed_reason = ""
    note.save(update_fields=["closed_at", "closed_reason"])
    log(staff, "reopen_note", note=note)


# ── 내보내기 ───────────────────────────────────────────────────


def kick(note: Note, member: NoteMember) -> None:
    """참여자를 내보낸다. 노트 안 닉네임을 남겨 두어 다시 허용 목록에 보인다."""
    with transaction.atomic():
        NoteBan.objects.get_or_create(note=note, user_id=member.user_id, defaults={"nickname": member.nickname})
        member.delete()
    note_id, user_id = note.id, member.user_id
    transaction.on_commit(lambda: _send_group(user_group(user_id), {"type": "member.kicked", "note": note_id}))


def is_kicked(note_id: str, user: User) -> bool:
    return getattr(user, "is_authenticated", False) and NoteBan.objects.filter(note_id=note_id, user=user).exists()


# ── 노트를 쓸 수 있는지 ────────────────────────────────────────


def check_note(note: Note, user: User) -> None:
    """닫힌 노트, 정지된 사용자, 내보낸 사람이면 Blocked."""
    if note.closed_at is not None:
        raise NoteClosed(f"운영 정책에 따라 닫힌 노트예요. 사유: {note.closed_reason}")
    check_user(user)
    if is_kicked(note.id, user):
        raise Kicked("노트를 만든 사람이 이 노트에서 내보냈어요.")


# ── 운영자 기록 ────────────────────────────────────────────────


# 같은 운영자가 같은 것을 이 시간(초) 안에 다시 열면 열람 기록을 한 번만 남긴다(새로고침 등)
VIEW_LOG_WINDOW = 60


def log(staff: User, action: str, note: Note | None = None, target_user_id: int | None = None, detail: str = "") -> None:
    if action.startswith("view_"):
        since = clock.now() - dt.timedelta(seconds=VIEW_LOG_WINDOW)
        if AdminLog.objects.filter(
            staff=staff, action=action, note_id=note.id if note else "", detail=detail[:300], created_at__gte=since
        ).exists():
            return
    AdminLog.objects.create(
        staff=staff,
        action=action,
        note_id=note.id if note else "",
        note_name=note.name if note else "",
        target_user_id=target_user_id,
        detail=detail[:300],
    )


def _send_group(group: str, event: dict) -> None:
    async_to_sync(get_channel_layer().group_send)(group, event)
