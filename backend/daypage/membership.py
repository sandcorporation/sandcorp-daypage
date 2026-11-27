"""노트 입장: 처음 들어온 사용자를 참여자로 만들고 닉네임·색을 배정한다."""

from django.db import IntegrityError, connection, transaction

from . import clock
from .models import Note, NoteMember, User
from .nicknames import pick_color, pick_nickname


class NoteFull(Exception):
    """정원이 차서 새 참여자를 받을 수 없음."""


def join(note: Note, user: User) -> NoteMember:
    """사용자를 노트 참여자로 만든다. 이미 참여자면 방문 시각만 갱신한다.

    정원이 찼으면 NoteFull. 이미 참여자인 사람은 정원과 무관하게 들어온다.
    """
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
                taken = list(NoteMember.objects.filter(note=locked).values_list("nickname", "color"))
                if locked.member_limit is not None and len(taken) >= locked.member_limit:
                    raise NoteFull
                nicknames = [n for n, _ in taken]
                colors = [c for _, c in taken]
                member = NoteMember.objects.create(
                    note=locked,
                    user=user,
                    nickname=pick_nickname(nicknames),
                    color=pick_color(colors),
                )
                announce_info(locked.pk)
                return member
        except IntegrityError:
            continue
    raise RuntimeError("참여자 배정에 실패했어요")


# 머리말 알림의 판. 노트 행을 잠근 채 받으므로 판이 큰 알림이 더 나중에 읽은(더 새) 값이다(#222).
INFO_SEQ = "daypage_note_info_seq"


def current_info(note_id: str) -> dict | None:
    """지금 노트 머리말(이름·참여 수·정원)과 그 판.

    읽는 쪽끼리 노트 행 잠금으로 줄을 세우고, 잠근 뒤에 판을 받고 수를 센다. 그래서 판이 클수록
    더 나중에 읽은 값이고, 알림이 늦게 도착해도 화면은 판이 더 작은 값을 버리면 된다.
    """
    with transaction.atomic():
        note = Note.objects.select_for_update().filter(pk=note_id).first()
        if note is None:
            return None
        with connection.cursor() as cursor:
            cursor.execute("SELECT nextval(%s)", [INFO_SEQ])
            (seq,) = cursor.fetchone()
        return {
            "name": note.name,
            "memberCount": note.members.count(),
            "memberLimit": note.member_limit,
            "seq": seq,
        }


def announce_info(note_id: str) -> None:
    """접속해 있는 사람들의 머리말(노트 이름·참여 수·정원)을 바로 바꾸게 알린다.

    저장이 끝난 뒤 그때의 값을 읽어 보낸다(종이·색 알림과 같은 노트 그룹). 동시에 바뀌면 알림이
    거꾸로 도착할 수 있어 판(seq)을 싣는다.
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .consumers import note_group

    def send() -> None:
        info = current_info(note_id)
        if info is None:
            return
        async_to_sync(get_channel_layer().group_send)(note_group(note_id), {"type": "note.info", **info})

    transaction.on_commit(send)


def membership(note_id: str, user: User) -> NoteMember | None:
    return NoteMember.objects.filter(note_id=note_id, user=user).select_related("note").first()
