from argparse import ArgumentParser

from django.core.management.base import BaseCommand
from django.db import transaction
from pycrdt import Doc

from daypage.models import Page, PageUpdate
from daypage.pages import page_key
from daypage.points import pack_points


def _pack(state: bytes) -> tuple[bytes, int]:
    """스냅샷의 옛 점을 바이너리로 바꾼 새 스냅샷과 바꾼 획 수."""
    doc = Doc()
    if state:
        doc.apply_update(state)
    packed = pack_points(doc)
    return (doc.get_update() if packed else state), packed


class Command(BaseCommand):
    help = (
        "이미 봉인된 페이지의 옛 숫자 배열 점(points)을 바이너리(pts)로 다시 써 스냅샷을 줄인다. "
        "기본은 드라이런(페이지별 전후 크기만 출력), 쓰려면 --write. 이미 pts인 획은 건너뛰어 두 번 돌려도 같다."
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--write", action="store_true", help="실제로 스냅샷을 다시 쓴다(페이지마다 트랜잭션 하나)")
        parser.add_argument("--note", help="이 노트의 페이지만. '-'로 시작하는 ID는 --note=ID 꼴로 쓴다")

    def handle(self, *args: object, write: bool = False, note: str | None = None, **options: object) -> None:
        pages = Page.objects.filter(sealed_at__isnull=False)
        if note:
            pages = pages.filter(note_id=note)
        changed = total_before = total_after = 0
        for page_id in pages.order_by("id").values_list("id", flat=True).iterator():
            with transaction.atomic():
                query = Page.objects.filter(pk=page_id)
                page = (query.select_for_update() if write else query).only("id", "note_id", "date", "seq", "state").get()
                if PageUpdate.objects.filter(page_id=page_id).exists():
                    # 봉인된 장에 증분이 남아 있을 리 없다. 있으면 손대지 않는다.
                    self.stderr.write(f"{page_id}: 합치지 않은 증분이 있어 건너뜀")
                    continue
                before = bytes(page.state)
                after, strokes = _pack(before)
                if not strokes:
                    continue
                if write:
                    page.state = after
                    page.save(update_fields=["state"])
            changed += 1
            total_before += len(before)
            total_after += len(after)
            key = page_key(page.date, page.seq)
            self.stdout.write(f"{page_id} {page.note_id} {key}: {len(before)} → {len(after)} 바이트 (획 {strokes}개)")
        mode = "썼음" if write else "드라이런: 쓰지 않음. 쓰려면 --write"
        self.stdout.write(f"바꿀 페이지 {changed}개, {total_before} → {total_after} 바이트 ({mode})")
