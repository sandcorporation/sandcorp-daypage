"""장 내용 저장: 스냅샷(Page.state) + 증분(PageUpdate)."""

import datetime as dt

from django.conf import settings
from django.db import models, transaction
from pycrdt import Doc, Map, XmlFragment, XmlText

from . import clock
from .models import Note, Page, PageUpdate


# 봉인이 예정보다 이만큼 안에서 늦은 것은 제때 봉인으로 본다(봉인 작업이 몇 초 늦게 돈다)
SEAL_DELAY_GRACE = dt.timedelta(minutes=1)


class PageSealed(Exception):
    """봉인된 장이거나 봉인 시각이 지나 더는 쓸 수 없는 장."""


def page_key(date: dt.date, seq: int = 1) -> str:
    """장을 가리키는 문자열. 그날 첫 장은 날짜 그대로, 둘째부터는 `-2`, `-3`을 붙인다."""
    return date.isoformat() if seq == 1 else f"{date.isoformat()}-{seq}"


def parse_key(key: str) -> tuple[dt.date, int]:
    """페이지 키를 (날짜, 순번)으로. 모양이 아니면 ValueError."""
    date = dt.date.fromisoformat(key[:10])
    rest = key[10:]
    if rest == "":
        return date, 1
    if not rest.startswith("-") or not rest[1:].isdigit():
        raise ValueError(key)
    seq = int(rest[1:])
    # 정규형만 받는다('-02', '-1' 같은 별칭은 경로마다 다르게 풀리므로)
    if seq < 2 or page_key(date, seq) != key:
        raise ValueError(key)
    return date, seq


def _new_page(note: Note, date: dt.date, seq: int, opened_at: dt.datetime, due_at: dt.datetime) -> Page:
    doc = Doc()
    doc.get("meta", type=Map)["date"] = date.isoformat()
    return Page.objects.create(note=note, date=date, seq=seq, opened_at=opened_at, due_at=due_at, state=doc.get_update())


def get_or_create_page(note: Note, date: dt.date) -> Page:
    """그 날짜의 첫 장(노트의 봉인 시각 기준 하루). 시험·시드용."""
    page = Page.objects.filter(note=note, date=date, seq=1).first()
    if page is not None:
        return page
    start = dt.datetime.combine(date, dt.time(hour=note.seal_hour), tzinfo=clock.KST)
    return _new_page(note, date, 1, start, start + dt.timedelta(days=1))


def _latest(note: Note) -> Page | None:
    return Page.objects.filter(note=note).order_by("-date", "-seq").first()


def open_page(note: Note, now: dt.datetime | None = None) -> Page:
    """지금 쓰는 장. 마지막 장이 아직 봉인 전이고 기간 안이면 그것, 아니면 새 장을 연다.

    마지막 장의 기간이 끝났는데 봉인 작업이 아직 안 돌았으면 먼저 봉인한다(사용자는 늘 올바른 장을 본다).
    새 장은 지금 이전의 가장 최근 경계(노트의 봉인 시각)에서 시작해 하루 뒤에 끝나고, 같은 날짜에 이미 장이
    있으면 다음 순번을 받는다.
    """
    from . import sealing

    now = now or clock.now()
    # 거의 늘 열린 장이 있다: 잠금 없이 먼저 본다(GET·웹소켓 입장마다 노트 행을 잠그지 않게)
    last = _latest(note)
    if last is not None and last.sealed_at is None and now < last.due_at:
        return last
    with transaction.atomic():
        note = Note.objects.select_for_update().get(pk=note.pk)
        last = _latest(note)
        if last is not None and last.sealed_at is None:
            if now < last.due_at:
                return last
            sealing.seal_page(last.id)
        start = clock.boundary_before(now, note.seal_hour)
        date = start.date()
        seq = (Page.objects.filter(note=note, date=date).aggregate(models.Max("seq"))["seq__max"] or 0) + 1
        page = _new_page(note, date, seq, start, start + dt.timedelta(days=1))
    # 봉인 작업보다 먼저 새 장을 열었으면 옛 장에 남은 접속자를 이리로 옮긴다
    sealing.announce_roll({note.id}, page_key(page.date, page.seq))
    return page


def reschedule_open_page(note: Note) -> Page | None:
    """봉인 시각이 바뀐 뒤: 열린 장의 봉인 예정을 '열린 뒤 처음 오는 새 봉인 시각'으로 고친다.

    10:49에 11시로 바꾸면 11:00, 새벽 1시에 4시로 바꾸면 04:00. 그 순간이 이미 지났으면(23:30에 23시) due가
    과거가 되어 바로 봉인 대상이 된다. 열린 장이 없으면 None.
    """
    page = _latest(note)
    if page is None or page.sealed_at is not None:
        return None
    page.due_at = clock.boundary_after(page.opened_at, note.seal_hour)
    page.save(update_fields=["due_at"])
    return page


def current_key(note: Note, now: dt.datetime | None = None) -> str:
    """지금 쓰는 장의 키. 장을 만들지는 않는다(미리보기·접속자 수 세기용)."""
    now = now or clock.now()
    last = _latest(note)
    if last is not None and last.sealed_at is None and now < last.due_at:
        return page_key(last.date, last.seq)
    date = clock.boundary_before(now, note.seal_hour).date()
    seq = (Page.objects.filter(note=note, date=date).aggregate(models.Max("seq"))["seq__max"] or 0) + 1
    return page_key(date, seq)


def _closed_at(page: Page) -> dt.datetime:
    """봉인된 장이 실제로 닫힌 순간.

    대개 due_at이다(그 뒤의 쓰기는 거부한다). 주인이 봉인 시각을 이미 지난 시각으로 바꿔 바로 봉인한 장만
    due_at이 지난 경계로 당겨져 있어 sealed_at까지 열려 있었다. 꼬박 하루짜리 장은 바로 봉인될 수 없으므로
    봉인 작업이 오래 밀렸어도 due_at이다.
    """
    if page.due_at - page.opened_at == dt.timedelta(days=1) or page.sealed_at - page.due_at < SEAL_DELAY_GRACE:
        return page.due_at
    return page.sealed_at


def recorded_pages(note: Note) -> list[tuple[Page, dt.datetime, dt.datetime]]:
    """기록에 보이는 장(봉인됐고 비지 않음)과 실제로 열려 있던 (시작, 끝). 새 것부터.

    바로 봉인한 뒤의 장은 opened_at이 지난 경계지만 앞 장이 닫힌 때부터 쓸 수 있었다. 앞 장이 비어 기록에
    없어도 따져야 하므로 빈 장까지 읽는다.
    """
    result = []
    previous_closed = None
    for page in Page.objects.filter(note=note, sealed_at__isnull=False).defer("state").order_by("date", "seq"):
        opened = page.opened_at if previous_closed is None else max(page.opened_at, previous_closed)
        previous_closed = _closed_at(page)
        if not page.is_empty:
            result.append((page, opened, previous_closed))
    return result[::-1]


def load_updates(page_id: int) -> list[bytes]:
    """스냅샷과 남은 증분을 순서대로 읽는다."""
    state = Page.objects.filter(pk=page_id).values_list("state", flat=True).get()
    rest = PageUpdate.objects.filter(page_id=page_id).order_by("id").values_list("update", flat=True)
    return [bytes(u) for u in [state, *rest] if u]


def build_doc(updates: list[bytes]) -> Doc:
    """pycrdt Doc은 만든 스레드에서만 쓸 수 있다. 쓸 스레드에서 이 함수를 부른다."""
    doc = Doc()
    for update in updates:
        doc.apply_update(update)
    return doc


def load_doc(page_id: int) -> Doc:
    return build_doc(load_updates(page_id))


def append_update(page_id: int, update: bytes, received_at: dt.datetime) -> int:
    """증분 하나를 저장한다. 받은 시각이 봉인 예정(due_at) 뒤면 거부한다.

    봉인 작업과 같은 Page 행 잠금을 잡아 봉인 직전·직후의 경합을 막는다. due_at 전에 받았는데 서버가 모아 두던
    사이 봉인이 먼저 돌았으면 봉인된 장에 마저 합친다(#266, sealing.absorb_late). 그 장의 기간에 그린 것이다.
    돌려주는 값은 아직 합쳐지지 않은 증분 수.
    """
    from . import sealing

    with transaction.atomic():
        page = Page.objects.select_for_update().get(pk=page_id)
        if received_at >= page.due_at:
            raise PageSealed
        if page.sealed_at is not None:
            sealing.absorb_late(page, update)
            return 0
        PageUpdate.objects.create(page=page, update=update)
        return PageUpdate.objects.filter(page=page).count()


def _piece_prefix(key: str) -> str:
    """지우개가 자른 조각은 원래 획 id의 앞 16자를 잇는다(frontend/src/page/doc.ts pieceId)."""
    return key[:16]


def late_strokes(base: bytes, update: bytes) -> dict[str, dict]:
    """봉인 예정 뒤 옛 장으로 온 갱신 update가 새로 그은 획: {id: 필드}. base는 그 갱신 전 방의 문서.

    옛 장에 있던 획을 고친 것(옮기기·지우개 조각·지우기)은 넣지 않는다. 옛 장은 봉인 때 모습 그대로 남고,
    새 장에는 그 획이 없기 때문이다.
    """
    doc = Doc()
    doc.apply_update(base)
    strokes = doc.get("strokes", type=Map)
    before = set(strokes.keys())
    prefixes = {_piece_prefix(k) for k in before}
    doc.apply_update(update)
    result = {}
    for key in set(strokes.keys()) - before:
        if _piece_prefix(key) in prefixes:
            continue
        value = strokes.get(key)
        if isinstance(value, Map):
            fields = value.to_py()
            # 레이어는 옛 장의 것이라 새 장에 없다: 기본 레이어에 둔다
            fields.pop("layer", None)
            result[key] = {k: bytes(v) if isinstance(v, bytearray) else v for k, v in fields.items()}
    return result


def carry_refused(page_id: int, update: bytes, received_at: dt.datetime) -> tuple[Page, bytes | None]:
    """봉인 예정이 앞당겨져(주인이 봉인 시각을 이미 지난 시각으로 바꿈) 방이 저장하지 못한 편집 update의 새 획을
    지금 장으로 옮긴다. 저장된 장 문서가 그 갱신 전 상태다(앞선 편집은 저장됐다)."""
    note_id = Page.objects.filter(pk=page_id).values_list("note_id", flat=True).get()
    strokes = late_strokes(_state_update(page_id), update)
    return carry_strokes(note_id, page_id, strokes, received_at)


def _state_update(page_id: int) -> bytes:
    doc = load_doc(page_id)
    return doc.get_update()


def carry_strokes(note_id: str, old_page_id: int, strokes: dict[str, dict], received_at: dt.datetime) -> tuple[Page, bytes | None]:
    """봉인 예정 뒤 옛 장에 그은 획을 지금 쓰는 장의 같은 자리로 옮긴다(#266). (지금 장, 저장한 갱신).

    지금 장이 아직 옛 장이면(봉인 예정이 뒤로 미뤄졌다) 옮기지 않는다. 새 장이 없으면 연다.
    """
    note = Note.objects.get(pk=note_id)
    page = open_page(note, received_at)
    if page.id == old_page_id or not strokes:
        return page, None
    doc = Doc()
    target = doc.get("strokes", type=Map)
    with doc.transaction():
        for key, fields in strokes.items():
            target[key] = Map(fields)
    update = doc.get_update()
    append_update(page.id, update, received_at)
    return page, update


def _merge(page: Page) -> Doc:
    doc = Doc()
    if page.state:
        doc.apply_update(bytes(page.state))
    updates = list(PageUpdate.objects.filter(page=page).order_by("id").values_list("id", "update"))
    for _, update in updates:
        doc.apply_update(bytes(update))
    page.state = doc.get_update()
    if updates:
        PageUpdate.objects.filter(page=page, id__lte=updates[-1][0]).delete()
    return doc


def compact(page_id: int) -> None:
    """쌓인 증분을 스냅샷에 합친다."""
    with transaction.atomic():
        page = Page.objects.select_for_update().filter(pk=page_id).first()
        if page is None:  # 노트가 지워져 장도 없다
            return
        _merge(page)
        page.save(update_fields=["state"])


def should_compact(pending: int) -> bool:
    return pending >= getattr(settings, "COMPACT_EVERY", 200)


def _has_text(node) -> bool:
    """글 상자 내용(XmlFragment) 안에 글자가 하나라도 있는지"""
    if isinstance(node, XmlText):
        return len(node) > 0
    return any(_has_text(child) for child in getattr(node, "children", []))


def drop_empty_text_boxes(doc: Doc) -> int:
    """글자가 하나도 없는 글 상자를 지운다(만들고 아무것도 쓰지 않은 채 나간 상자). 지운 수를 돌려준다."""
    boxes = doc.get("textboxes", type=Map)
    empty = [
        key
        for key, box in list(boxes.items())
        if isinstance(box, Map) and isinstance(box.get("content"), XmlFragment) and not _has_text(box.get("content"))
    ]
    if empty:
        with doc.transaction():
            for key in empty:
                del boxes[key]
    return len(empty)


def doc_stats(doc: Doc) -> tuple[int, int, bool]:
    """(획 수, 참여 인원, 빈 장 여부). 참여 인원은 획·글 상자·사진을 만든 사람 수."""
    strokes = doc.get("strokes", type=Map)
    boxes = doc.get("textboxes", type=Map)
    photos = doc.get("photos", type=Map)
    authors: set[str] = set()
    for item in list(strokes.values()) + list(boxes.values()) + list(photos.values()):
        if isinstance(item, Map) and item.get("author"):
            authors.add(str(item.get("author")))
    return len(strokes), len(authors), len(strokes) == 0 and len(boxes) == 0 and len(photos) == 0
