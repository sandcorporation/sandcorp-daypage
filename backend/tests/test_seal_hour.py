"""노트마다 다른 봉인 시각(#42·#43): 4시 봉인 노트의 경계, 봉인 시각 바꾸기."""

import datetime as dt

import pytest
from asgiref.sync import sync_to_async

from daypage import clock, pages
from daypage.consumers import MESSAGE_NOTE_PAGE, MESSAGE_PAGE_ROLLED
from daypage.models import Note, Page
from daypage.sealing import seal_and_announce
from tests.helpers import create_note, login_as
from tests.ws import expect_close, join, open_ws

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


@pytest.fixture
def moment(monkeypatch):
    state = {"now": kst(2026, 10, 16, 3, 59, 50)}
    monkeypatch.setattr(clock, "now", lambda: state["now"])
    return state


@sync_to_async
def note_sealing_at(hour: int):
    owner = login_as(1)
    note_id = create_note(owner)
    Note.objects.filter(pk=note_id).update(seal_hour=hour)
    return owner, note_id


@sync_to_async
def page_rows(note_id: str) -> list[tuple[str, int, bool]]:
    return [(p.date.isoformat(), p.seq, p.sealed_at is not None) for p in Page.objects.filter(note_id=note_id).order_by("date", "seq")]


async def test_four_oclock_note_accepts_until_four_then_seals_and_rolls(moment):
    owner, note_id = await note_sealing_at(4)
    # 새벽 3:59, 아직 어제(10/15) 장
    y = await join(owner, note_id, "2026-10-15")
    await y.add_stroke("before")
    await y.drain()

    moment["now"] = kst(2026, 10, 16, 4, 0, 5)
    await sync_to_async(seal_and_announce)()
    msg = await y.ws.receive_output(timeout=3)
    assert msg["bytes"][0] == MESSAGE_PAGE_ROLLED
    assert b'"key":"2026-10-16"' in msg["bytes"]
    assert await expect_close(y.ws) == 4409
    assert await page_rows(note_id) == [("2026-10-15", 1, True), ("2026-10-16", 1, False)]


async def test_write_after_due_is_refused_even_before_the_sealing_job_runs(moment):
    owner, note_id = await note_sealing_at(4)
    y = await join(owner, note_id, "2026-10-15")
    moment["now"] = kst(2026, 10, 16, 4, 0, 1)
    await y.add_stroke("late")
    assert await expect_close(y.ws) == 4409


async def test_joining_a_page_that_is_not_open_is_refused(moment):
    owner, note_id = await note_sealing_at(4)
    ws = await open_ws(owner, note_id, "2026-10-16")  # 아직 열리지 않은 오늘 장
    assert await expect_close(ws) == 4409
    ws = await open_ws(owner, note_id, "2026-10-15-2")  # 없는 순번
    assert await expect_close(ws) == 4409


async def test_bad_key_is_not_found(moment):
    owner, note_id = await note_sealing_at(0)
    ws = await open_ws(owner, note_id, "2026-10-15-1")
    assert await expect_close(ws) == 4404


async def test_owner_moves_seal_hour_forward_and_the_page_seals_eleven_minutes_later(moment):
    """10:49에 11시로 바꾸면 11:00에 봉인되고 같은 날짜 (2) 장이 열린다."""
    owner, note_id = await note_sealing_at(0)
    moment["now"] = kst(2026, 10, 16, 10, 49)
    y = await join(owner, note_id, "2026-10-16")

    res = await sync_to_async(owner.patch)(f"/api/notes/{note_id}", {"sealHour": 11}, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["sealHour"] == 11
    assert dt.datetime.fromisoformat(res.json()["page"]["dueAt"]) == kst(2026, 10, 16, 11, 0)
    # 접속자에게 바뀐 봉인 예정 시각이 간다
    msg = await y.ws.receive_output(timeout=3)
    assert msg["bytes"][0] == MESSAGE_NOTE_PAGE
    assert b'"sealHour":11' in msg["bytes"]

    moment["now"] = kst(2026, 10, 16, 11, 0, 5)
    await sync_to_async(seal_and_announce)()
    msg = await y.ws.receive_output(timeout=3)
    assert msg["bytes"][0] == MESSAGE_PAGE_ROLLED
    assert b'"key":"2026-10-16-2"' in msg["bytes"]
    assert await expect_close(y.ws) == 4409
    assert await page_rows(note_id) == [("2026-10-16", 1, True), ("2026-10-16", 2, False)]


async def test_moving_seal_hour_to_a_time_already_passed_seals_right_away(moment):
    """23:30에 23시로 바꾸면 오늘 장은 바로 봉인되고 접속자는 (2) 장으로 옮겨진다."""
    owner, note_id = await note_sealing_at(0)
    moment["now"] = kst(2026, 10, 16, 23, 30)
    y = await join(owner, note_id, "2026-10-16")
    res = await sync_to_async(owner.patch)(f"/api/notes/{note_id}", {"sealHour": 23}, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["page"]["key"] == "2026-10-16-2"
    msg = await y.ws.receive_output(timeout=3)
    assert msg["bytes"][0] == MESSAGE_PAGE_ROLLED
    assert b'"key":"2026-10-16-2"' in msg["bytes"]
    assert await expect_close(y.ws) == 4409
    assert await page_rows(note_id) == [("2026-10-16", 1, True), ("2026-10-16", 2, False)]


async def test_night_owl_moves_midnight_to_four_at_one_am(moment):
    """새벽 1시에 4시로 바꾸면 오늘 장은 4시에 봉인된다."""
    owner, note_id = await note_sealing_at(0)
    moment["now"] = kst(2026, 10, 17, 1, 0)
    await join(owner, note_id, "2026-10-17")
    res = await sync_to_async(owner.patch)(f"/api/notes/{note_id}", {"sealHour": 4}, content_type="application/json")
    assert dt.datetime.fromisoformat(res.json()["page"]["dueAt"]) == kst(2026, 10, 17, 4, 0)


async def test_only_the_owner_can_change_the_seal_hour_and_only_to_a_valid_hour(moment):
    owner, note_id = await note_sealing_at(0)
    guest = await sync_to_async(login_as)(2)
    await sync_to_async(guest.get)(f"/api/notes/{note_id}")
    res = await sync_to_async(guest.patch)(f"/api/notes/{note_id}", {"sealHour": 4}, content_type="application/json")
    assert res.status_code == 403
    res = await sync_to_async(owner.patch)(f"/api/notes/{note_id}", {"sealHour": 24}, content_type="application/json")
    assert res.status_code == 400
    assert await sync_to_async(lambda: Note.objects.get(pk=note_id).seal_hour)() == 0
    assert pages  # noqa: B018  (모듈을 썼다는 표시)
