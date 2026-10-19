"""운영자 API(/api/admin/...). 운영자(User.is_staff)만 쓴다. 노트 내용은 돌려주지 않고 개수·날짜만 본다."""

import datetime as dt
from typing import Literal

from asgiref.sync import sync_to_async
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import Coalesce, ExtractHour, Length, TruncDate
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.security import SessionAuth

from . import admission, clock
from .models import Note, Page, Suggestion, User


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
        for p in Page.objects.filter(date=today, note_id__in=[n.id for n in notes])
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
        }
        for u in users
    ]
