"""노트 입장: 처음 들어온 사용자를 참여자로 만들고 닉네임·색을 배정한다."""

from django.db import IntegrityError, transaction

from . import clock
from .models import Note, NoteMember, User
from .nicknames import pick_color, pick_nickname


def join(note: Note, user: User) -> NoteMember:
    """사용자를 노트 참여자로 만든다. 이미 참여자면 방문 시각만 갱신한다."""
    member = NoteMember.objects.filter(note=note, user=user).first()
    if member:
        NoteMember.objects.filter(pk=member.pk).update(last_visited_at=clock.now())
        return member

    for _ in range(5):
        try:
            with transaction.atomic():
                # 같은 노트에 동시에 들어와도 닉네임·정원 검사가 겹치지 않게 노트 행을 잠근다.
                locked = Note.objects.select_for_update().get(pk=note.pk)
                existing = NoteMember.objects.filter(note=locked, user=user).first()
                if existing:
                    return existing
                taken = NoteMember.objects.filter(note=locked).values_list("nickname", "color")
                nicknames = [n for n, _ in taken]
                colors = [c for _, c in taken]
                return NoteMember.objects.create(
                    note=locked,
                    user=user,
                    nickname=pick_nickname(nicknames),
                    color=pick_color(colors),
                )
        except IntegrityError:
            continue
    raise RuntimeError("참여자 배정에 실패했어요")


def membership(note_id: str, user: User) -> NoteMember | None:
    return NoteMember.objects.filter(note_id=note_id, user=user).select_related("note").first()
