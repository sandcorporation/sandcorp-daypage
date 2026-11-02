import datetime as dt
import json
import re
from typing import Any, Literal

from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.http import Http404, HttpResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from ninja import Field, NinjaAPI, Schema
from ninja.security import django_auth

from . import clock, membership, moderation, pages, paper, photos, rooms, sealing, shortcuts, suggestions
from .models import Note, NoteBan, NoteMember, Page, Photo, Suggestion


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        self.status = status
        self.code = code
        self.detail = detail


# 운영(DEBUG=False)에서는 /api/docs·/api/openapi.json을 끈다(#110).
api = NinjaAPI(
    title="Daypage API",
    urls_namespace="api",
    auth=django_auth,
    docs_url="/docs" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)


@api.exception_handler(ApiError)
def _api_error(request, exc: ApiError):
    return api.create_response(request, {"code": exc.code, "detail": exc.detail}, status=exc.status)


@api.exception_handler(moderation.Blocked)
def _blocked(request, exc: moderation.Blocked):
    """닫힌 노트·정지된 사용자·내보낸 사람(moderation.py). 화면은 code로 안내를 고른다."""
    return api.create_response(request, {"code": exc.code, "detail": exc.detail}, status=403)


def share_url(note_id: str) -> str:
    return f"{settings.PUBLIC_ORIGIN.rstrip('/')}/note/{note_id}"


def online_count(note: Note) -> int:
    """지금 쓰는 장에 접속한 사람 수(같은 사람의 여러 탭은 한 명)."""
    conns = rooms.registry().connections_sync(note.id)
    return rooms.online_users(conns, pages.current_key(note))


def page_info(page: Page) -> dict:
    """노트 API가 주는 장 정보. key로 방에 붙고, dueAt까지 남은 시간을 센다."""
    return {
        "key": pages.page_key(page.date, page.seq),
        "date": page.date.isoformat(),
        "seq": page.seq,
        "openedAt": page.opened_at.astimezone(clock.KST).isoformat(),
        "dueAt": page.due_at.astimezone(clock.KST).isoformat(),
    }


@api.get("/health", auth=None)
def health(request):
    return {"ok": True}


@api.get("/client-config", auth=None)
def client_config(request):
    """프론트가 실행할 때 받아 가는 설정. 오류 수집 DSN은 빌드에 넣지 않고 여기서 내려준다(운영에서만 값이 있다)."""
    return {
        "sentryDsn": settings.SENTRY_FRONTEND_DSN or None,
        "environment": settings.SENTRY_ENVIRONMENT,
        # 사진 저장소가 설정돼 있을 때만 사진 붙이기를 보인다
        "photos": photos.configured(),
    }


@api.get("/me", auth=None)
def me(request):
    # SPA가 POST 요청에 쓸 CSRF 쿠키를 여기서 내려준다.
    get_token(request)
    if not request.user.is_authenticated:
        return {"authenticated": False, "isStaff": False, "notes": [], "suspension": None}
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
    return {
        "authenticated": True,
        "isStaff": request.user.is_staff,
        "notes": notes,
        # 정지 중이면 {until(영구면 null), reason}. 첫 화면이 사유를 보인다.
        "suspension": moderation.suspension(request.user),
    }


@api.get("/me/shortcuts")
def get_shortcuts(request):
    """내가 바꾼 단축키(기본값과 다른 동작만)."""
    return request.user.shortcuts or {}


@api.put("/me/shortcuts")
def put_shortcuts(request):
    """바꾼 단축키를 통째로 저장한다. 빈 {}이면 모두 기본값."""
    try:
        raw = json.loads(request.body or b"null")
    except ValueError:
        raw = None
    value = shortcuts.validate(raw)
    if value is None:
        raise ApiError(422, "invalid_shortcuts", "단축키 값이 올바르지 않아요.")
    request.user.shortcuts = value
    request.user.save(update_fields=["shortcuts"])
    return value


class SuggestionIn(Schema):
    text: str
    noteId: str | None = None
    # 보낼 때의 화면 상태. 무엇이 와도 건의는 받고, 남길 것만 고른다(suggestions.clean_context).
    context: Any = None


SUGGESTION_MAX = 1000


@api.post("/suggestions", response={201: dict})
def create_suggestion(request, payload: SuggestionIn):
    """기능 건의 남기기. 보낸 노트는 그 노트 참여자일 때만 함께 남긴다."""
    text = payload.text.strip()
    if not text:
        raise ApiError(400, "empty", "건의할 내용을 적어 주세요.")
    if len(text) > SUGGESTION_MAX:
        raise ApiError(400, "too_long", f"건의는 {SUGGESTION_MAX}자까지 쓸 수 있어요.")
    since = clock.now() - dt.timedelta(days=1)
    if Suggestion.objects.filter(user=request.user, created_at__gte=since).count() >= settings.SUGGESTIONS_PER_DAY:
        raise ApiError(429, "too_many", "오늘은 건의를 많이 남기셨어요. 내일 다시 보내 주세요.")
    note_id = payload.noteId
    if note_id and not NoteMember.objects.filter(note_id=note_id, user=request.user).exists():
        note_id = None
    context = suggestions.clean_context(payload.context)
    s = Suggestion.objects.create(user=request.user, note_id=note_id, text=text, context=context)
    suggestions.announce(s.id, "new")
    return 201, {"id": s.id}


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
    moderation.check_user(request.user)
    note = Note.objects.create(
        name=clean_name(body.name), owner=request.user, member_limit=clean_limit(body.memberLimit)
    )
    membership.join(note, request.user)
    return {"id": note.id, "url": share_url(note.id)}


@api.get("/notes/{note_id}/preview", auth=None)
def preview(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    return {"name": note.name, "online": online_count(note), "isFull": note.is_full()}


@api.get("/notes/{note_id}")
def note_detail(request, note_id: str):
    note = get_object_or_404(Note, pk=note_id)
    moderation.check_note(note, request.user)
    try:
        member = membership.join(note, request.user)
    except membership.NoteFull:
        raise ApiError(403, "note_full", "이 노트는 정원이 찼어요.")
    page = pages.open_page(note)
    return {
        "id": note.id,
        "name": note.name,
        "url": share_url(note.id),
        "isOwner": note.owner_id == request.user.id,
        "page": page_info(page),
        "sealHour": note.seal_hour,
        # 옛 번들(봉인 시각 배포 전)을 띄워 둔 탭이 페이지 교체 때 다시 읽어도 죽지 않게 당분간 같이 준다(GlitchTip #102).
        # 2026-11 이후 지워도 된다.
        "today": page.date.isoformat(),
        "nextMidnight": page.due_at.astimezone(clock.KST).isoformat(),
        "serverNow": clock.now().isoformat(),
        "me": {"nickname": member.nickname, "color": member.color},
        "online": online_count(note),
        "memberCount": note.members.count(),
        "memberLimit": note.member_limit,
        "colors": note.colors,
        "paper": paper.normalize(note.paper),
    }


class PaperIn(Schema):
    pattern: Literal["lined", "grid", "dot", "blank"] | None = None
    margin: bool | None = None
    # 기본 색 이름이나 직접 만든 색 코드(#rrggbb)
    color: str | None = Field(None, pattern=paper.COLOR_INPUT)


@api.patch("/notes/{note_id}/paper")
def update_paper(request, note_id: str, body: PaperIn):
    """노트 종이 바꾸기. 참여자라면 누구나. 준 항목만 바꾸고, 접속해 있는 사람들의 화면도 바로 바꾼다."""
    member_note(request, note_id)
    with transaction.atomic():
        note = Note.objects.select_for_update().get(pk=note_id)
        current = paper.normalize(note.paper)
        changes = {k: v for k, v in body.dict().items() if v is not None}
        note.paper = paper.normalize({**current, **changes})
        note.save(update_fields=["paper"])
        announce_note_event(note.id, {"type": "note.paper", "paper": note.paper})
    return note.paper


class UpdateNoteIn(Schema):
    name: str | None = None
    memberLimit: int | None = None
    # 봉인 시각(KST 0~23시)
    sealHour: int | None = None


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
        rescheduled = None
        if body.sealHour is not None:
            if not 0 <= body.sealHour <= 23:
                raise ApiError(400, "bad_seal_hour", "봉인 시각은 0시부터 23시 사이예요.")
            note.seal_hour = body.sealHour
            rescheduled = pages.reschedule_open_page(note)
        note.save()
    if rescheduled is not None:
        now = clock.now()
        if rescheduled.due_at <= now:
            # 새 봉인 시각이 이미 지났다: 이 노트의 장만 바로 봉인하고 접속자를 새 장으로 옮긴다
            sealing.roll_note(note, now)
        else:
            announce_note_event(
                note.id,
                {
                    "type": "note.page",
                    "key": pages.page_key(rescheduled.date, rescheduled.seq),
                    "dueAt": rescheduled.due_at.astimezone(clock.KST).isoformat(),
                    "sealHour": note.seal_hour,
                },
            )
    return {
        "id": note.id,
        "name": note.name,
        "memberLimit": note.member_limit,
        "sealHour": note.seal_hour,
        "page": page_info(pages.open_page(note)),
    }


def member_note(request, note_id: str) -> Note:
    note = get_object_or_404(Note, pk=note_id)
    moderation.check_note(note, request.user)
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
    announce_note_event(note_id, {"type": "note.colors", "colors": colors})


def announce_note_event(note_id: str, event: dict) -> None:
    """노트에 접속해 있는 연결들에 알린다(저장이 끝난 뒤)."""
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .consumers import note_group

    def send() -> None:
        async_to_sync(get_channel_layer().group_send)(note_group(note_id), event)

    transaction.on_commit(send)


@api.get("/notes/{note_id}/pages")
def sealed_pages(request, note_id: str):
    note = member_note(request, note_id)
    sealed = Page.objects.filter(note=note, sealed_at__isnull=False, is_empty=False).order_by("-date", "-seq")
    return [
        {
            "key": pages.page_key(p.date, p.seq),
            "date": p.date.isoformat(),
            "seq": p.seq,
            "openedAt": p.opened_at.astimezone(clock.KST).isoformat(),
            # 봉인된 순간이 아니라 기간이 끝난 순간(봉인 작업이 늦어도 같다)
            "closedAt": p.due_at.astimezone(clock.KST).isoformat(),
            "participantCount": p.participant_count,
            "strokeCount": p.stroke_count,
            # 그날 쓰던 종이(종이 설정 전에 봉인한 장은 기본 줄 노트)
            "paper": paper.normalize(p.paper),
        }
        for p in sealed
    ]


@api.get("/notes/{note_id}/today")
def today_page_snapshot(request, note_id: str):
    """지금 쓰는 장의 Yjs 문서(바이너리). 책으로 저장할 때 오늘 장을 담는 데 쓴다. 참여자라면 누구나."""
    note = member_note(request, note_id)
    page = pages.open_page(note)
    res = HttpResponse(pages.build_doc(pages.load_updates(page.id)).get_update(), content_type="application/octet-stream")
    # 쓰는 중인 장이라 계속 바뀐다.
    res["Cache-Control"] = "no-store"
    return res


@api.get("/notes/{note_id}/pages/{key}")
def sealed_page_snapshot(request, note_id: str, key: str):
    note = member_note(request, note_id)
    try:
        day, seq = pages.parse_key(key)
    except ValueError:
        raise Http404
    page = get_object_or_404(Page, note=note, date=day, seq=seq, sealed_at__isnull=False, is_empty=False)
    res = HttpResponse(bytes(page.state), content_type="application/octet-stream")
    # 봉인된 장은 바뀌지 않는다.
    res["Cache-Control"] = "private, max-age=86400, immutable"
    return res


@api.post("/notes/{note_id}/photos")
def upload_photo(request, note_id: str):
    """사진 올리기(본문은 줄인 그림 바이트 그대로). 참여자라면 누구나, 지금 쓰는 장에 매인다. 장 문서에 붙이는 건 브라우저가 한다."""
    note = member_note(request, note_id)
    s = photos.store()
    if s is None:
        raise ApiError(503, "photos_off", "지금은 사진을 붙일 수 없어요.")
    data = request.body
    if len(data) > photos.PHOTO_MAX_BYTES:
        raise ApiError(413, "photo_too_big", "사진이 너무 커요.")
    mime = photos.sniff_mime(data)
    if mime is None:
        raise ApiError(400, "bad_photo", "JPEG·PNG·WebP 사진만 붙일 수 있어요.")
    with transaction.atomic():
        page = Page.objects.select_for_update().get(pk=pages.open_page(note).pk)
        if Photo.objects.filter(page=page).count() >= photos.UPLOADS_PER_PAGE:
            raise ApiError(429, "photos_full", "오늘 페이지에는 사진을 더 올릴 수 없어요.")
        photo = Photo.objects.create(id=photos.new_id(), note=note, page=page, uploader=request.user, mime=mime, size=len(data))
        # 저장소에 못 올리면 행도 남기지 않는다(트랜잭션이 되돌린다)
        try:
            s.put(photos.object_key(note.id, photo.id), data, mime)
        except Exception:
            raise ApiError(502, "photo_store_failed", "사진을 올리지 못했어요. 잠시 뒤 다시 해 주세요.")
    return {"id": photo.id}


@api.get("/notes/{note_id}/photos/{photo_id}")
def get_photo(request, note_id: str, photo_id: str):
    note = member_note(request, note_id)
    return photo_response(note, photo_id)


def photo_response(note: Note, photo_id: str) -> HttpResponse:
    """사진 원본. 저장소에서 받아 그대로 준다(같은 출처라 캔버스에 그려 저장할 수 있다)."""
    photo = get_object_or_404(Photo, pk=photo_id, note=note)
    s = photos.store()
    if s is None:
        raise Http404
    try:
        data = s.get(photos.object_key(note.id, photo.id))
    except Exception:
        raise Http404
    res = HttpResponse(data, content_type=photo.mime)
    # 같은 id의 사진은 바뀌지 않는다. 저장소 요청을 줄이려고 브라우저가 오래 들고 있게 한다.
    res["Cache-Control"] = "private, max-age=31536000, immutable"
    res["X-Content-Type-Options"] = "nosniff"
    return res


@api.delete("/notes/{note_id}")
def delete_note(request, note_id: str):
    """만든 사람만 지운다. 참여자가 있어도 지우고, 장·기록까지 모두 바로 없앤다(보관하지 않음)."""
    note = owned_note(request, note_id)
    photo_keys = [photos.object_key(note.id, pid) for pid in Photo.objects.filter(note=note).values_list("id", flat=True)]
    note.delete()
    photos.delete_later(photo_keys)
    # 접속해 있던 사람들의 방을 닫아 '노트를 찾을 수 없어요'로 보낸다.
    transaction.on_commit(lambda: announce_note_deleted(note_id))
    return HttpResponse(status=204)


def announce_note_deleted(note_id: str) -> None:
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .consumers import note_group

    async_to_sync(get_channel_layer().group_send)(note_group(note_id), {"type": "note.deleted"})


# ── 참여자 내보내기(노트를 만든 사람만) ─────────────────────────


@api.get("/notes/{note_id}/members")
def note_members(request, note_id: str):
    """참여자와 내보낸 사람 목록. 만든 사람만 본다."""
    note = owned_note(request, note_id)
    members = NoteMember.objects.filter(note=note).order_by("joined_at", "id")
    return {
        "members": [
            {
                "id": m.id,
                "nickname": m.nickname,
                "color": m.color,
                "isOwner": m.user_id == note.owner_id,
                "lastVisitedAt": m.last_visited_at.isoformat(),
            }
            for m in members
        ],
        "kicked": [
            {"id": b.id, "nickname": b.nickname, "at": b.created_at.isoformat()}
            for b in NoteBan.objects.filter(note=note).order_by("-created_at")
        ],
    }


@api.post("/notes/{note_id}/members/{member_id}/kick")
def kick_member(request, note_id: str, member_id: int):
    """참여자를 내보낸다. 접속해 있으면 바로 끊고, 다시 허용할 때까지 들어오지 못한다."""
    note = owned_note(request, note_id)
    member = get_object_or_404(NoteMember, pk=member_id, note=note)
    if member.user_id == note.owner_id:
        raise ApiError(400, "kick_owner", "노트를 만든 사람은 내보낼 수 없어요.")
    moderation.kick(note, member)
    return {"ok": True}


@api.delete("/notes/{note_id}/kicked/{ban_id}")
def allow_again(request, note_id: str, ban_id: int):
    """내보낸 사람을 다시 들어올 수 있게 한다(다시 들어오면 새 닉네임을 받는다)."""
    note = owned_note(request, note_id)
    get_object_or_404(NoteBan, pk=ban_id, note=note).delete()
    return HttpResponse(status=204)


# 운영자 API는 따로 둔다(운영자만).
from .admin_api import router as admin_router  # noqa: E402

api.add_router("/admin", admin_router)
