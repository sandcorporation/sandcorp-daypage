"""장 내용 저장: 스냅샷(Page.state) + 증분(PageUpdate)."""

import datetime as dt

from django.conf import settings
from django.db import transaction
from pycrdt import Doc, Map

from . import clock
from .models import Note, Page, PageUpdate


class PageSealed(Exception):
    """봉인된 장이거나 자정이 지나 더는 쓸 수 없는 장."""


def get_or_create_page(note: Note, date: dt.date) -> Page:
    page, created = Page.objects.get_or_create(note=note, date=date)
    if created:
        doc = Doc()
        doc.get("meta", type=Map)["date"] = date.isoformat()
        page.state = doc.get_update()
        page.save(update_fields=["state"])
    return page


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
        if page.sealed_at is not None or clock.kst_date_of(received_at) != page.date:
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


def doc_stats(doc: Doc) -> tuple[int, int, bool]:
    """(획 수, 참여 인원, 빈 장 여부). 참여 인원은 획·글 상자를 만든 사람 수."""
    strokes = doc.get("strokes", type=Map)
    boxes = doc.get("textboxes", type=Map)
    authors: set[str] = set()
    for item in list(strokes.values()) + list(boxes.values()):
        if isinstance(item, Map) and item.get("author"):
            authors.add(str(item.get("author")))
    return len(strokes), len(authors), len(strokes) == 0 and len(boxes) == 0
