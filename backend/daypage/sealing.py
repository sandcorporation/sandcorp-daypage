"""봉인: 기간이 끝난 장을 최종 스냅샷으로 굳히고 접속자에게 페이지 교체를 알린다."""

import datetime as dt
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from . import clock
from .models import Note, Page
from .pages import _merge, current_key, doc_stats, drop_empty_text_boxes

logger = logging.getLogger(__name__)


def seal_page(page_id: int) -> bool:
    """장 하나를 봉인한다. 이미 봉인됐으면 False."""
    with transaction.atomic():
        # 웹소켓 쪽 증분 저장과 같은 행 잠금을 잡는다.
        page = Page.objects.select_for_update().get(pk=page_id)
        if page.sealed_at is not None:
            return False
        doc = _merge(page)
        # 만들고 아무것도 쓰지 않은 채 남은 빈 글 상자는 기록에 남기지 않는다.
        if drop_empty_text_boxes(doc):
            page.state = doc.get_update()
        page.stroke_count, page.participant_count, page.is_empty = doc_stats(doc)
        page.sealed_at = clock.now()
        # 그날 쓰던 노트 종이를 남긴다(뒤에 노트 종이를 바꿔도 지난 기록은 그대로 보이게)
        page.paper = Note.objects.filter(pk=page.note_id).values_list("paper", flat=True).first() or {}
        page.save(update_fields=["state", "stroke_count", "participant_count", "is_empty", "sealed_at", "paper"])
        return True


def seal_due_pages(now: dt.datetime | None = None) -> list[Page]:
    """봉인 예정 시각이 지난 장을 모두 봉인한다. 여러 번 돌려도 결과가 같다."""
    now = now or clock.now()
    due = list(Page.objects.filter(sealed_at__isnull=True, due_at__lte=now).order_by("date", "seq"))
    sealed = []
    for page in due:
        if seal_page(page.id):
            sealed.append(page)
    if sealed:
        logger.info("페이지 %d개 봉인", len(sealed))
    return sealed


def announce_roll(note_ids: set[str], key: str) -> None:
    """노트 접속자에게 페이지 교체를 알린다. key는 새로 열린 장의 키."""
    from .consumers import note_group

    layer = get_channel_layer()
    for note_id in note_ids:
        async_to_sync(layer.group_send)(note_group(note_id), {"type": "page.rolled", "key": key})


def _announce_next(note_ids: set[str], now: dt.datetime) -> None:
    """노트마다 다음 장의 키로 교체를 알린다. 장은 만들지 않는다(아무도 안 들어오는 노트에 빈 장이 매일 쌓이지 않게)."""
    for note_id in note_ids:
        note = Note.objects.filter(pk=note_id).first()
        if note is not None:
            announce_roll({note_id}, current_key(note, now))


def seal_and_announce(now: dt.datetime | None = None) -> int:
    """기간이 끝난 장을 모두 봉인하고 그 노트들의 접속자에게 교체를 알린다(봉인 작업)."""
    now = now or clock.now()
    sealed = seal_due_pages(now)
    _announce_next({p.note_id for p in sealed}, now)
    return len(sealed)


def roll_note(note: Note, now: dt.datetime | None = None) -> int:
    """이 노트의 기간이 끝난 장만 봉인하고 교체를 알린다(주인이 봉인 시각을 이미 지난 시각으로 바꿨을 때)."""
    now = now or clock.now()
    due = list(Page.objects.filter(note=note, sealed_at__isnull=True, due_at__lte=now).order_by("date", "seq"))
    sealed = [p for p in due if seal_page(p.id)]
    if sealed:
        _announce_next({note.id}, now)
    return len(sealed)
