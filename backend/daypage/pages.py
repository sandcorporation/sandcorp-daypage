"""장 내용 저장: 스냅샷(Page.state) + 증분(PageUpdate)."""

import datetime as dt

from django.conf import settings
from django.db import models, transaction
from pycrdt import Doc, Map, XmlFragment, XmlText

from . import clock
from .models import Note, Page, PageUpdate


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
    if not rest.startswith("-") or not rest[1:].isdigit() or int(rest[1:]) < 2:
        raise ValueError(key)
    return date, int(rest[1:])


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
        return _new_page(note, date, seq, start, start + dt.timedelta(days=1))


def current_key(note: Note, now: dt.datetime | None = None) -> str:
    """지금 쓰는 장의 키. 장을 만들지는 않는다(미리보기·접속자 수 세기용)."""
    now = now or clock.now()
    last = _latest(note)
    if last is not None and last.sealed_at is None and now < last.due_at:
        return page_key(last.date, last.seq)
    date = clock.boundary_before(now, note.seal_hour).date()
    seq = (Page.objects.filter(note=note, date=date).aggregate(models.Max("seq"))["seq__max"] or 0) + 1
    return page_key(date, seq)


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
    """증분 하나를 저장한다. 받은 시각 기준으로 지난 장이거나 봉인됐으면 거부한다.

    봉인 작업과 같은 Page 행 잠금을 잡아 봉인 직전·직후의 경합을 막는다.
    돌려주는 값은 아직 합쳐지지 않은 증분 수.
    """
    with transaction.atomic():
        page = Page.objects.select_for_update().get(pk=page_id)
        if page.sealed_at is not None or received_at >= page.due_at:
            raise PageSealed
        PageUpdate.objects.create(page=page, update=update)
        return PageUpdate.objects.filter(page=page).count()


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
    """(획 수, 참여 인원, 빈 장 여부). 참여 인원은 획·글 상자를 만든 사람 수."""
    strokes = doc.get("strokes", type=Map)
    boxes = doc.get("textboxes", type=Map)
    authors: set[str] = set()
    for item in list(strokes.values()) + list(boxes.values()):
        if isinstance(item, Map) and item.get("author"):
            authors.add(str(item.get("author")))
    return len(strokes), len(authors), len(strokes) == 0 and len(boxes) == 0
