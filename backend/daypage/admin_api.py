"""운영자 API(/api/admin/...). 운영자(User.is_staff)만 쓴다.

목록은 개수·날짜만 보인다. 노트 내용은 노트 하나를 열어야 보이고, 열람과 조치(닫기·정지)는
모두 운영자 기록(AdminLog)에 남는다(moderation.py)."""

import datetime as dt
from typing import Literal

from asgiref.sync import sync_to_async
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import Coalesce, ExtractHour, Length, TruncDate
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.security import SessionAuth

from . import admission, clock, moderation, pages
from .models import AdminLog, Note, NoteMember, Page, Suggestion, User


class StaffAuth(SessionAuth):
    """로그인했고 운영자인 사용자만. 아니면 401."""

    def authenticate(self, request, key):
        user = super().authenticate(request, key)
        return user if user is not None and getattr(user, "is_staff", False) else None


router = Router(auth=StaffAuth())

DAYS = 14
LIST_LIMIT = 300


def _today_range() -> tuple[dt.datetime, dt.datetime]:
    start = dt.datetime.combine(clock.today_kst(), dt.time.min, tzinfo=clock.KST)
    return start, start + dt.timedelta(days=1)


def _has_content(qs):
    """내용이 있는 장: 봉인됐으면 is_empty로, 오늘 장이면 스냅샷이나 증분이 있는지로 본다."""
    return qs.filter(
        Q(sealed_at__isnull=False, is_empty=False)
        | Q(sealed_at__isnull=True) & (Q(updates__isnull=False) | Q(state__isnull=False) & ~Q(state=b""))
    ).distinct()


def _stats_from_db() -> dict:
    today = clock.today_kst()
    start, end = _today_range()
    first = today - dt.timedelta(days=DAYS - 1)
    since = dt.datetime.combine(first, dt.time.min, tzinfo=clock.KST)

    def per_day(qs, field="created_at"):
        rows = (
            qs.filter(**{f"{field}__gte": since})
            .annotate(d=TruncDate(field, tzinfo=clock.KST))
            .values("d")
            .annotate(n=Count("id"))
        )
        return {r["d"]: r["n"] for r in rows}

    signups = per_day(User.objects.all())
    notes = per_day(Note.objects.all())
    pages = Page.objects.filter(date__gte=first)
    active = {r["date"]: r["n"] for r in _has_content(pages).values("date").annotate(n=Count("id", distinct=True))}
    participants = {
        r["date"]: r["n"]
        for r in pages.filter(sealed_at__isnull=False).values("date").annotate(n=Sum("participant_count"))
    }
    daily = []
    for i in range(DAYS):
        d = first + dt.timedelta(days=i)
        daily.append(
            {
                "date": d.isoformat(),
                "signups": signups.get(d, 0),
                "notes": notes.get(d, 0),
                "activeNotes": active.get(d, 0),
                # 봉인된 장의 참여 인원 합(오늘은 아직 봉인 전이라 null)
                "participants": participants.get(d) if d != today else None,
            }
        )

    def per_hour(qs, field="created_at"):
        rows = (
            qs.filter(**{f"{field}__gte": start, f"{field}__lt": end})
            .annotate(h=ExtractHour(field, tzinfo=clock.KST))
            .values("h")
            .annotate(n=Count("id"))
        )
        return {r["h"]: r["n"] for r in rows}

    h_signups = per_hour(User.objects.all())
    h_notes = per_hour(Note.objects.all())
    from .models import NoteMember

    h_visits = per_hour(NoteMember.objects.all(), "last_visited_at")
    hourly = [
        {"hour": h, "signups": h_signups.get(h, 0), "notes": h_notes.get(h, 0), "lastVisits": h_visits.get(h, 0)}
        for h in range(24)
    ]

    return {
        "totals": {"users": User.objects.count(), "notes": Note.objects.count()},
        "today": {
            "date": today.isoformat(),
            "signups": User.objects.filter(created_at__gte=start, created_at__lt=end).count(),
            "notes": Note.objects.filter(created_at__gte=start, created_at__lt=end).count(),
            # 오늘 노트를 연 사람(노트별 마지막 방문 시각 기준)
            "visitors": NoteMember.objects.filter(last_visited_at__gte=start, last_visited_at__lt=end)
            .values("user")
            .distinct()
            .count(),
        },
        "daily": daily,
        "hourly": hourly,
        "suggestions": {"new": Suggestion.objects.filter(status=Suggestion.Status.NEW).count()},
    }


@router.get("/stats")
async def stats(request):
    body = await sync_to_async(_stats_from_db)()
    snap = await admission.store().snapshot()
    body["online"] = {
        "connections": len(snap.online),
        "users": len({c.user_id for c in snap.online}),
        "waiting": len(snap.waiting),
        "capacity": snap.capacity,
    }
    return body


# ── 건의함 ─────────────────────────────────────────────────


@router.get("/suggestions")
def list_suggestions(request, status: str | None = None):
    qs = Suggestion.objects.select_related("note").order_by("-created_at", "-id")
    if status:
        qs = qs.filter(status=status)
    return [
        {
            "id": s.id,
            "text": s.text,
            "status": s.status,
            "createdAt": s.created_at.isoformat(),
            "userId": s.user_id,
            "noteId": s.note_id,
            "noteName": s.note.name if s.note else None,
        }
        for s in qs[:LIST_LIMIT]
    ]


class StatusIn(Schema):
    status: Literal["new", "reviewing", "done", "declined"]


@router.patch("/suggestions/{suggestion_id}")
def update_suggestion(request, suggestion_id: int, payload: StatusIn):
    s = get_object_or_404(Suggestion, pk=suggestion_id)
    s.status = payload.status
    s.save(update_fields=["status"])
    return {"id": s.id, "status": s.status}


# ── 노트·사용자 목록(내용 없이 개수와 날짜만) ─────────────────


@router.get("/notes")
def list_notes(request):
    today = clock.today_kst()
    notes = list(
        Note.objects.annotate(
            member_count=Count("members", distinct=True),
            page_count=Count("pages", distinct=True),
            last_visit=Max("members__last_visited_at"),
        ).order_by("-last_visit", "-created_at")[:LIST_LIMIT]
    )
    sizes = {
        p["note_id"]: p["size"]
        for p in Page.objects.filter(sealed_at__isnull=True, note_id__in=[n.id for n in notes])
        .annotate(size=Coalesce(Length("state"), 0) + Coalesce(Sum(Length("updates__update")), 0))
        .values("note_id", "size")
    }
    return [
        {
            "id": n.id,
            "name": n.name,
            "createdAt": n.created_at.isoformat(),
            "ownerId": n.owner_id,
            "memberCount": n.member_count,
            "memberLimit": n.member_limit,
            "pageCount": n.page_count,
            "lastVisitedAt": n.last_visit.isoformat() if n.last_visit else None,
            # 오늘 장의 저장 크기(바이트). 내용은 보지 않는다.
            "todayBytes": sizes.get(n.id, 0),
            "closed": n.closed_at is not None,
        }
        for n in notes
    ]


@router.get("/users")
def list_users(request):
    users = User.objects.annotate(
        owned=Count("owned_notes", distinct=True),
        joined=Count("memberships", distinct=True),
        last_visit=Max("memberships__last_visited_at"),
        suggested=Count("suggestions", distinct=True),
    ).order_by("-last_visit", "-created_at")[:LIST_LIMIT]
    return [
        {
            "id": u.id,
            "createdAt": u.created_at.isoformat(),
            "ownedNotes": u.owned,
            "memberships": u.joined,
            "suggestions": u.suggested,
            "lastVisitedAt": u.last_visit.isoformat() if u.last_visit else None,
            "isStaff": u.is_staff,
            "suspended": moderation.suspension(u) is not None,
        }
        for u in users
    ]


# ── 노트 하나 보기(읽기 전용, 열람 기록) ─────────────────────────


def _bad_request(detail: str) -> HttpResponse:
    return HttpResponse(detail, status=400, content_type="text/plain; charset=utf-8")


@router.get("/notes/{note_id}")
def note_detail(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    moderation.log(request.auth, "view_note", note=note)
    members = NoteMember.objects.filter(note=note).order_by("joined_at", "id")
    sealed = Page.objects.filter(note=note, sealed_at__isnull=False, is_empty=False).order_by("-date", "-seq")
    return {
        "id": note.id,
        "name": note.name,
        "createdAt": note.created_at.isoformat(),
        "ownerId": note.owner_id,
        "memberLimit": note.member_limit,
        "paper": note.paper,
        "closed": moderation.closed(note),
        # 지금 쓰는 장의 키(장을 만들지는 않는다)
        "openPage": pages.current_key(note),
        "sealHour": note.seal_hour,
        "members": [
            {
                "id": m.id,
                "userId": m.user_id,
                "nickname": m.nickname,
                "color": m.color,
                "joinedAt": m.joined_at.isoformat(),
                "lastVisitedAt": m.last_visited_at.isoformat(),
            }
            for m in members
        ],
        "pages": [
            {
                "key": pages.page_key(p.date, p.seq),
                "date": p.date.isoformat(),
                "seq": p.seq,
                "openedAt": p.opened_at.astimezone(clock.KST).isoformat(),
                "closedAt": p.due_at.astimezone(clock.KST).isoformat(),
                "participantCount": p.participant_count,
                "strokeCount": p.stroke_count,
                "paper": p.paper,
            }
            for p in sealed
        ],
    }


@router.get("/notes/{note_id}/pages/{key}")
def note_page(request, note_id: str, key: str):
    """장 하나의 Yjs 문서(바이너리). 봉인된 장은 그대로, 쓰는 중인 장은 스냅샷과 증분을 합쳐 준다."""
    note = get_object_or_404(Note, pk=note_id)
    try:
        day, seq = pages.parse_key(key)
    except ValueError:
        raise Http404
    page = get_object_or_404(Page, note=note, date=day, seq=seq)
    moderation.log(request.auth, "view_page", note=note, detail=key)
    if page.sealed_at is not None:
        data = bytes(page.state)
    else:
        data = pages.build_doc(pages.load_updates(page.id)).get_update()
    res = HttpResponse(data, content_type="application/octet-stream")
    res["Cache-Control"] = "no-store"
    return res


class ReasonIn(Schema):
    reason: str



@router.post("/notes/{note_id}/close")
def close_note(request, note_id: str, payload: ReasonIn):
    note = get_object_or_404(Note, pk=note_id)
    reason = (payload.reason or "").strip()
    if not reason:
        return _bad_request("닫는 사유를 적어 주세요.")
    moderation.close_note(request.auth, note, reason[: moderation.REASON_MAX])
    return {"id": note.id, "closed": moderation.closed(note)}


@router.post("/notes/{note_id}/reopen")
def reopen_note(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    moderation.reopen_note(request.auth, note)
    return {"id": note.id, "closed": None}


# ── 사용자 하나 보기·정지 ────────────────────────────────────────


@router.get("/users/{user_id}")
def user_detail(request, user_id: int):
    user = get_object_or_404(User, pk=user_id)
    memberships = NoteMember.objects.filter(user=user).select_related("note").order_by("-last_visited_at")
    return {
        "id": user.id,
        "createdAt": user.created_at.isoformat(),
        "isStaff": user.is_staff,
        "suspension": moderation.suspension(user),
        "notes": [
            {
                "id": m.note_id,
                "name": m.note.name,
                "nickname": m.nickname,
                "isOwner": m.note.owner_id == user.id,
                "lastVisitedAt": m.last_visited_at.isoformat(),
                "closed": m.note.closed_at is not None,
            }
            for m in memberships
        ],
    }


class SuspendIn(Schema):
    # 정지 기간(일). null이면 영구.
    days: Literal[1, 7, 30] | None
    reason: str


@router.post("/users/{user_id}/suspend")
def suspend_user(request, user_id: int, payload: SuspendIn):
    user = get_object_or_404(User, pk=user_id)
    if user.is_staff:
        return _bad_request("운영자는 정지할 수 없어요.")
    reason = (payload.reason or "").strip()
    if not reason:
        return _bad_request("정지 사유를 적어 주세요.")
    s = moderation.suspend(request.auth, user, payload.days, reason[: moderation.REASON_MAX])
    return {"id": user.id, "suspension": s}


@router.post("/users/{user_id}/unsuspend")
def unsuspend_user(request, user_id: int):
    user = get_object_or_404(User, pk=user_id)
    moderation.unsuspend(request.auth, user)
    return {"id": user.id, "suspension": None}


# ── 운영자 기록 ──────────────────────────────────────────────────


@router.get("/logs")
def logs(request):
    rows = AdminLog.objects.order_by("-created_at", "-id")[:LIST_LIMIT]
    return [
        {
            "id": r.id,
            "at": r.created_at.isoformat(),
            "staffId": r.staff_id,
            "action": r.action,
            "noteId": r.note_id or None,
            "noteName": r.note_name or None,
            "targetUserId": r.target_user_id,
            "detail": r.detail,
        }
        for r in rows
    ]
