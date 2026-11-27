"""알림이 실패해도 내보낸·정지한 사람·닫힌 노트의 열린 연결은 곧 끊긴다(#256).

들어온 연결은 마지막 권한 확인 뒤 consumers.RECHECK_AFTER가 지나면 메시지를 받을 때(읽기만 하는 연결은 하트비트 때)
입장 때와 같은 판정을 다시 한다. 막혔으면 그 메시지는 버리고 입장 때와 같은 코드로 닫는다."""

import datetime as dt

import pytest
from asgiref.sync import sync_to_async
from pycrdt import Doc, Map

from daypage import clock, consumers, rooms
from daypage.models import Note, NoteBan, NoteMember, Page, PageUpdate, User
from tests.helpers import create_note, login_as
from tests.ws import awareness_message, expect_close, join

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 16, 15, 0, tzinfo=clock.KST)
DATE = "2026-10-16"
LATER = TODAY + consumers.RECHECK_AFTER + dt.timedelta(seconds=1)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    state = {"now": TODAY}
    monkeypatch.setattr(clock, "now", lambda: state["now"])
    return state


@sync_to_async
def setup_note():
    owner = login_as(1)
    note_id = create_note(owner)
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    return note_id, guest


@sync_to_async
def strokes(note_id: str) -> set[str]:
    page = Page.objects.get(note_id=note_id, date=TODAY.date())
    doc = Doc()
    if page.state:
        doc.apply_update(bytes(page.state))
    for u in PageUpdate.objects.filter(page=page).order_by("id"):
        doc.apply_update(bytes(u.update))
    return set(doc.get("strokes", type=Map).keys())


# 알림 없이 DB만 바꾼다(알림 서버가 멈춘 순간의 조치와 같다).


@sync_to_async
def kick_quietly(note_id: str) -> None:
    member = NoteMember.objects.get(note_id=note_id, user__kakao_id=2)
    NoteBan.objects.create(note_id=note_id, user_id=member.user_id, nickname=member.nickname)
    member.delete()


@sync_to_async
def suspend_quietly(note_id: str) -> None:
    User.objects.filter(kakao_id=2).update(suspension_permanent=True, suspension_reason="욕설")


@sync_to_async
def close_quietly(note_id: str) -> None:
    Note.objects.filter(pk=note_id).update(closed_at=TODAY, closed_reason="광고")


@pytest.mark.parametrize(
    ("block", "code"),
    [(kick_quietly, consumers.CLOSE_KICKED), (suspend_quietly, consumers.CLOSE_SUSPENDED), (close_quietly, consumers.CLOSE_CLOSED)],
)
async def test_edit_after_recheck_window_is_dropped_and_closes(fixed_clock, block, code):
    note_id, guest = await setup_note()
    y = await join(guest, note_id, DATE)
    await block(note_id)
    # 확인 주기 안: 시계만 보고 그대로 받는다.
    await y.add_stroke("before")
    await y.sync()
    fixed_clock["now"] = LATER
    await y.add_stroke("after")
    assert await expect_close(y.ws) == code
    assert await strokes(note_id) == {"before"}


async def test_reader_that_only_sends_cursors_is_closed_too(fixed_clock):
    note_id, guest = await setup_note()
    y = await join(guest, note_id, DATE)
    await kick_quietly(note_id)
    fixed_clock["now"] = LATER
    await y.ws.send_to(bytes_data=awareness_message(7, 1, {"cursor": None}))
    assert await expect_close(y.ws) == consumers.CLOSE_KICKED


async def test_silent_reader_is_closed_by_heartbeat(fixed_clock, monkeypatch):
    monkeypatch.setattr(rooms, "HEARTBEAT_EVERY", 0.01)
    note_id, guest = await setup_note()
    y = await join(guest, note_id, DATE)
    await suspend_quietly(note_id)
    fixed_clock["now"] = LATER
    assert await expect_close(y.ws) == consumers.CLOSE_SUSPENDED


async def test_allowed_member_keeps_writing_across_rechecks(fixed_clock, monkeypatch):
    calls = []
    real = consumers._recheck

    async def counting(*args):
        calls.append(args)
        return await real(*args)

    note_id, guest = await setup_note()
    y = await join(guest, note_id, DATE)
    monkeypatch.setattr(consumers, "_recheck", counting)
    for i in range(3):
        await y.add_stroke(f"s{i}")
    await y.sync()
    assert calls == []  # 주기 안에서는 DB를 치지 않는다
    fixed_clock["now"] = LATER
    await y.add_stroke("s3")
    await y.add_stroke("s4")
    await y.sync()
    assert len(calls) == 1
    assert await strokes(note_id) == {"s0", "s1", "s2", "s3", "s4"}
    await y.close()
