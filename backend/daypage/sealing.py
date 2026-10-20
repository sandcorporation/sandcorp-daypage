"""자정 봉인: 지난 장을 최종 스냅샷으로 굳히고 접속자에게 자정 교체를 알린다."""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from . import clock
from .models import Note, Page
from .pages import _merge, doc_stats, drop_empty_text_boxes

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


def seal_due_pages() -> list[Page]:
    """오늘(KST) 이전의 봉인 안 된 장을 모두 봉인한다. 여러 번 돌려도 결과가 같다."""
    today = clock.today_kst()
    due = list(Page.objects.filter(sealed_at__isnull=True, date__lt=today).order_by("date"))
    sealed = []
    for page in due:
        if seal_page(page.id):
            sealed.append(page)
    if sealed:
        logger.info("페이지 %d개 봉인", len(sealed))
    return sealed


def announce_roll(note_ids: set[str], today: str) -> None:
    from .consumers import note_group

    layer = get_channel_layer()
    for note_id in note_ids:
        async_to_sync(layer.group_send)(note_group(note_id), {"type": "page.rolled", "date": today})


def seal_and_announce() -> int:
    sealed = seal_due_pages()
    announce_roll({p.note_id for p in sealed}, clock.today_kst().isoformat())
    return len(sealed)
