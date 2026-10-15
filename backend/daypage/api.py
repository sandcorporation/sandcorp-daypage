from django.conf import settings
from django.db.models import Count
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from ninja import NinjaAPI, Schema
from ninja.security import django_auth

from . import clock, membership
from .models import Note, NoteMember


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
    # 실시간 접속 집계는 Presence 단계에서 채운다.
    return 0


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
            "memberLimit": None,
        }
        for m in memberships
    ]
    return {"authenticated": True, "notes": notes}


class CreateNoteIn(Schema):
    name: str | None = None


def clean_name(name: str | None) -> str:
    name = (name or "").strip()
    if len(name) > 60:
        raise ApiError(400, "name_too_long", "노트 이름은 60자까지 쓸 수 있어요.")
    return name or Note.DEFAULT_NAME


@api.post("/notes")
def create_note(request, body: CreateNoteIn):
    note = Note.objects.create(name=clean_name(body.name), owner=request.user)
    membership.join(note, request.user)
    return {"id": note.id, "url": share_url(note.id)}


@api.get("/notes/{note_id}/preview", auth=None)
def preview(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    return {"name": note.name, "online": online_count(note.id), "isFull": False}


@api.get("/notes/{note_id}")
def note_detail(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    member = membership.join(note, request.user)
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
        "memberLimit": None,
    }


class UpdateNoteIn(Schema):
    name: str | None = None


def owned_note(request, note_id: str) -> Note:
    note = get_object_or_404(Note, pk=note_id)
    if note.owner_id != request.user.id:
        raise ApiError(403, "not_owner", "노트를 만든 사람만 바꿀 수 있어요.")
    return note


@api.patch("/notes/{note_id}")
def update_note(request, note_id: str, body: UpdateNoteIn):
    note = owned_note(request, note_id)
    if body.name is not None:
        note.name = clean_name(body.name)
    note.save()
    return {"id": note.id, "name": note.name}
