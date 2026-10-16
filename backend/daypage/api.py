import datetime as dt
import re

from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.http import Http404, HttpResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from ninja import NinjaAPI, Schema
from ninja.security import django_auth

from . import clock, membership, rooms
from .models import Note, NoteMember, Page


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        self.status = status
        self.code = code
        self.detail = detail


api = NinjaAPI(title="Daypage API", urls_namespace="api", auth=django_auth)


@api.exception_handler(ApiError)
def _api_error(request, exc: ApiError):
    return api.create_response(request, {"code": exc.code, "detail": exc.detail}, status=exc.status)


def share_url(note_id: str) -> str:
    return f"{settings.PUBLIC_ORIGIN.rstrip('/')}/note/{note_id}"


def online_count(note_id: str) -> int:
    """오늘 장에 접속한 사람 수(같은 사람의 여러 탭은 한 명)."""
    conns = rooms.registry().connections_sync(note_id)
    return rooms.online_users(conns, clock.today_kst().isoformat())


@api.get("/health", auth=None)
def health(request):
    return {"ok": True}


@api.get("/me", auth=None)
def me(request):
    # SPA가 POST 요청에 쓸 CSRF 쿠키를 여기서 내려준다.
    get_token(request)
    if not request.user.is_authenticated:
        return {"authenticated": False, "notes": []}
    memberships = (
        NoteMember.objects.filter(user=request.user)
        .select_related("note")
        .annotate(member_count=Count("note__members"))
        .order_by("-last_visited_at", "-joined_at")
    )
    notes = [
        {
            "id": m.note.id,
            "name": m.note.name,
            "isOwner": m.note.owner_id == request.user.id,
            "memberCount": m.member_count,
            "memberLimit": m.note.member_limit,
        }
        for m in memberships
    ]
    return {"authenticated": True, "notes": notes}


MIN_MEMBER_LIMIT = 2
MAX_MEMBER_LIMIT = 1000


class CreateNoteIn(Schema):
    name: str | None = None
    memberLimit: int | None = None


def clean_limit(limit: int | None) -> int | None:
    if limit is None:
        return None
    if not MIN_MEMBER_LIMIT <= limit <= MAX_MEMBER_LIMIT:
        raise ApiError(400, "invalid_limit", "정원은 2명 이상이어야 해요.")
    return limit


def clean_name(name: str | None) -> str:
    name = (name or "").strip()
    if len(name) > 60:
        raise ApiError(400, "name_too_long", "노트 이름은 60자까지 쓸 수 있어요.")
    return name or Note.DEFAULT_NAME


@api.post("/notes")
def create_note(request, body: CreateNoteIn):
    note = Note.objects.create(
        name=clean_name(body.name), owner=request.user, member_limit=clean_limit(body.memberLimit)
    )
    membership.join(note, request.user)
    return {"id": note.id, "url": share_url(note.id)}


@api.get("/notes/{note_id}/preview", auth=None)
def preview(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    return {"name": note.name, "online": online_count(note.id), "isFull": note.is_full()}


@api.get("/notes/{note_id}")
def note_detail(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    try:
        member = membership.join(note, request.user)
    except membership.NoteFull:
        raise ApiError(403, "note_full", "이 노트는 정원이 찼어요.")
    return {
        "id": note.id,
        "name": note.name,
        "url": share_url(note.id),
        "isOwner": note.owner_id == request.user.id,
        "today": clock.today_kst().isoformat(),
        "nextMidnight": clock.next_midnight_kst().isoformat(),
        "serverNow": clock.now().isoformat(),
        "me": {"nickname": member.nickname, "color": member.color},
        "online": online_count(note.id),
        "memberCount": note.members.count(),
        "memberLimit": note.member_limit,
        "colors": note.colors,
    }


class UpdateNoteIn(Schema):
    name: str | None = None
    memberLimit: int | None = None


def owned_note(request, note_id: str) -> Note:
    note = get_object_or_404(Note, pk=note_id)
    if note.owner_id != request.user.id:
        raise ApiError(403, "not_owner", "노트를 만든 사람만 바꿀 수 있어요.")
    return note


@api.patch("/notes/{note_id}")
def update_note(request, note_id: str, body: UpdateNoteIn):
    owned_note(request, note_id)
    with transaction.atomic():
        # 입장(membership.join)과 같은 행 잠금 안에서 검사하고 저장해 정원을 넘지 않게 한다.
        note = Note.objects.select_for_update().get(pk=note_id)
        if body.name is not None:
            note.name = clean_name(body.name)
        # memberLimit은 null(무제한)도 의미가 있으므로 보냈는지 여부로 구분한다.
        if "memberLimit" in body.model_fields_set:
            limit = clean_limit(body.memberLimit)
            if limit is not None and limit < note.members.count():
                raise ApiError(400, "limit_below_members", "지금 참여자 수보다 적게 줄일 수 없어요.")
            note.member_limit = limit
        note.save()
    return {"id": note.id, "name": note.name, "memberLimit": note.member_limit}


def member_note(request, note_id: str) -> Note:
    note = get_object_or_404(Note, pk=note_id)
    if not NoteMember.objects.filter(note=note, user=request.user).exists():
        raise ApiError(403, "not_member", "이 노트의 참여자만 볼 수 있어요.")
    return note


MAX_NOTE_COLORS = 8
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class AddColorIn(Schema):
    color: str


def clean_color(color: str) -> str:
    if not HEX_COLOR.match(color or ""):
        raise ApiError(400, "bad_color", "색 코드는 #RRGGBB 꼴로 적어 주세요.")
    return color.lower()


@api.post("/notes/{note_id}/colors")
def add_note_color(request, note_id: str, body: AddColorIn):
    """노트 색 더하기. 참여자라면 누구나. 이미 있으면 그대로 둔다."""
    member_note(request, note_id)
    color = clean_color(body.color)
    with transaction.atomic():
        note = Note.objects.select_for_update().get(pk=note_id)
        if color not in note.colors:
            if len(note.colors) >= MAX_NOTE_COLORS:
                raise ApiError(400, "colors_full", f"노트 색은 {MAX_NOTE_COLORS}개까지 둘 수 있어요.")
            note.colors = [*note.colors, color]
            note.save(update_fields=["colors"])
            announce_note_colors(note.id, note.colors)
    return {"colors": note.colors}


@api.delete("/notes/{note_id}/colors/{color}")
def remove_note_color(request, note_id: str, color: str):
    """노트 색 빼기. 참여자라면 누구나. 그 색으로 이미 그린 획은 바뀌지 않는다."""
    member_note(request, note_id)
    color = clean_color(f"#{color}")
    with transaction.atomic():
        note = Note.objects.select_for_update().get(pk=note_id)
        if color in note.colors:
            note.colors = [c for c in note.colors if c != color]
            note.save(update_fields=["colors"])
            announce_note_colors(note.id, note.colors)
    return {"colors": note.colors}


def announce_note_colors(note_id: str, colors: list[str]) -> None:
    """접속해 있는 사람들의 도구 막대를 바로 바꾸게 알린다(저장이 끝난 뒤)."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .consumers import note_group

    def send() -> None:
        async_to_sync(get_channel_layer().group_send)(note_group(note_id), {"type": "note.colors", "colors": colors})

    transaction.on_commit(send)


@api.get("/notes/{note_id}/pages")
def sealed_pages(request, note_id: str):
    note = member_note(request, note_id)
    pages = Page.objects.filter(note=note, sealed_at__isnull=False, is_empty=False).order_by("-date")
    return [
        {"date": p.date.isoformat(), "participantCount": p.participant_count, "strokeCount": p.stroke_count}
        for p in pages
    ]


@api.get("/notes/{note_id}/pages/{date}")
def sealed_page_snapshot(request, note_id: str, date: str):
    note = member_note(request, note_id)
    try:
        day = dt.date.fromisoformat(date)
    except ValueError:
        raise Http404
    page = get_object_or_404(Page, note=note, date=day, sealed_at__isnull=False, is_empty=False)
    res = HttpResponse(bytes(page.state), content_type="application/octet-stream")
    # 봉인된 장은 바뀌지 않는다.
    res["Cache-Control"] = "private, max-age=86400, immutable"
    return res


@api.delete("/notes/{note_id}")
def delete_note(request, note_id: str):
    """만든 사람만 지운다. 참여자가 있어도 지우고, 장·기록까지 모두 바로 없앤다(보관하지 않음)."""
    note = owned_note(request, note_id)
    note.delete()
    # 접속해 있던 사람들의 방을 닫아 '노트를 찾을 수 없어요'로 보낸다.
    transaction.on_commit(lambda: announce_note_deleted(note_id))
    return HttpResponse(status=204)


def announce_note_deleted(note_id: str) -> None:
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .consumers import note_group

    async_to_sync(get_channel_layer().group_send)(note_group(note_id), {"type": "note.deleted"})
