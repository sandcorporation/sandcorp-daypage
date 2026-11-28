"""장이 바뀌는 순간 그린 것(#266).

- 봉인 예정(due_at) 전에 받은 편집은 서버가 모아 두던 사이 봉인이 먼저 돌았어도 앞 장에 남는다.
- due_at 뒤에 옛 장으로 온 편집은 앞 장에 넣지 않는다. 새로 그은 획은 새 장의 같은 자리로 옮긴다.
"""

import datetime as dt
import threading

import pytest
from asgiref.sync import sync_to_async
from django.db import connection
from pycrdt import Doc, Map

from daypage import clock, hub, pages, sealing
from daypage.consumers import MESSAGE_PAGE_ROLLED
from daypage.models import Note, Page, PageUpdate
from tests.helpers import create_note, login_as
from tests.waiting import until, until_sync
from tests.ws import YClient, expect_close, join

YESTERDAY = dt.date(2026, 10, 15)


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


DUE = kst(2026, 10, 16)
JUST_BEFORE = DUE - dt.timedelta(milliseconds=200)


def stroke_update(strokes: dict[str, dict]) -> bytes:
    doc = Doc()
    s = doc.get("strokes", type=Map)
    for sid, fields in strokes.items():
        s[sid] = Map(fields)
    return doc.get_update()


def pen(author: str, **extra) -> dict:
    return {"tool": "pen", "author": author, "points": [1.0, 2.0, 0.5, 3.0, 4.0, 0.5], **extra}


def strokes_of(state: bytes) -> dict:
    doc = Doc()
    doc.apply_update(bytes(state))
    return doc.get("strokes", type=Map).to_py()


def page_strokes(page_id: int) -> dict:
    doc = pages.load_doc(page_id)
    return doc.get("strokes", type=Map).to_py()


@pytest.fixture
def note(db):
    return Note.objects.get(pk=create_note(login_as(1)))


@pytest.fixture
def at(monkeypatch):
    def set_now(moment: dt.datetime):
        monkeypatch.setattr(clock, "now", lambda: moment)

    return set_now


# ── 저장 경로(pages.append_update) ──────────────────────────────


def test_edit_received_before_due_lands_on_page_sealed_first(note, at):
    """(가) 봉인이 먼저 돈 뒤 due_at 전에 받은 묶음이 저장되면 앞 장에 들어가고, 숫자도 그것까지 센다."""
    page = pages.get_or_create_page(note, YESTERDAY)
    PageUpdate.objects.create(page=page, update=stroke_update({"s1": pen("졸린 수달")}))
    at(DUE + dt.timedelta(seconds=1))
    sealing.seal_page(page.id)

    pages.append_update(page.id, stroke_update({"s2": pen("푸른 펭귄")}), JUST_BEFORE)

    page.refresh_from_db()
    strokes = strokes_of(page.state)
    assert set(strokes) == {"s1", "s2"}
    # 봉인 때처럼 점을 바이너리로 다시 쓴다
    assert "pts" in strokes["s2"] and "points" not in strokes["s2"]
    assert (page.stroke_count, page.participant_count, page.is_empty) == (2, 2, False)
    assert PageUpdate.objects.filter(page=page).count() == 0


def test_empty_sealed_page_with_a_late_stroke_shows_in_the_record(note, at):
    page = pages.get_or_create_page(note, YESTERDAY)
    at(DUE + dt.timedelta(seconds=1))
    sealing.seal_page(page.id)
    page.refresh_from_db()
    assert page.is_empty

    pages.append_update(page.id, stroke_update({"s1": pen("졸린 수달")}), JUST_BEFORE)

    assert [p.id for p, _, _ in pages.recorded_pages(note)] == [page.id]


@pytest.mark.parametrize("sealed", [False, True])
def test_edit_received_at_or_after_due_does_not_enter_the_page(note, at, sealed):
    """(나) due_at 뒤에 받은 것은 봉인 전이든 뒤든 앞 장에 들어가지 않는다."""
    page = pages.get_or_create_page(note, YESTERDAY)
    if sealed:
        at(DUE + dt.timedelta(seconds=1))
        sealing.seal_page(page.id)
    before = bytes(Page.objects.get(pk=page.id).state)

    with pytest.raises(pages.PageSealed):
        pages.append_update(page.id, stroke_update({"late": pen("a")}), DUE)

    assert bytes(Page.objects.get(pk=page.id).state) == before
    assert PageUpdate.objects.filter(page=page).count() == 0


@pytest.mark.django_db(transaction=True)
def test_save_waiting_on_the_seal_lock_is_not_lost(monkeypatch):
    """(다) 봉인이 행 잠금을 쥔 동안 온 저장은 잠금을 기다렸다가 봉인된 장에 들어간다."""
    note = Note.objects.get(pk=create_note(login_as(1)))
    page = pages.get_or_create_page(note, YESTERDAY)
    PageUpdate.objects.create(page=page, update=stroke_update({"s1": pen("졸린 수달")}))
    monkeypatch.setattr(clock, "now", lambda: DUE + dt.timedelta(seconds=1))
    holding, release = threading.Event(), threading.Event()
    real_merge = sealing._merge

    def held_merge(p):
        holding.set()
        release.wait(5)
        return real_merge(p)

    monkeypatch.setattr(sealing, "_merge", held_merge)
    errors: list[BaseException] = []

    def run(fn):
        try:
            fn()
        except BaseException as e:  # 스레드 안의 실패를 시험으로 넘긴다
            errors.append(e)
        finally:
            connection.close()

    sealer = threading.Thread(target=run, args=(lambda: sealing.seal_page(page.id),))
    saver = threading.Thread(
        target=run, args=(lambda: pages.append_update(page.id, stroke_update({"s2": pen("푸른 펭귄")}), JUST_BEFORE),)
    )
    sealer.start()
    try:
        assert holding.wait(5)
        saver.start()
        # 저장이 봉인의 행 잠금을 기다리기 시작했다
        until_sync(lambda: _lock_waiters() > 0)
    finally:
        release.set()
    sealer.join(5)
    saver.join(5)
    assert errors == []

    page.refresh_from_db()
    assert page.sealed_at is not None
    assert set(strokes_of(page.state)) == {"s1", "s2"}
    assert page.stroke_count == 2


def _lock_waiters() -> int:
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
        return cursor.fetchone()[0]


# ── 옮길 획 고르기(pages.late_strokes) ──────────────────────────


def test_only_newly_drawn_strokes_are_carried():
    base_doc = Doc()
    strokes = base_doc.get("strokes", type=Map)
    old_id = "abcdefghijklmnop0000"
    strokes[old_id] = Map(pen("a"))
    strokes["moved-stroke-id-000"] = Map(pen("a"))
    base = base_doc.get_update()

    before = base_doc.get_state()
    with base_doc.transaction():
        # 지우개가 자른 조각(원래 id 앞 16자를 잇는다)과 원래 획 지우기
        strokes["abcdefghijklmnop1111"] = Map(pen("a"))
        del strokes[old_id]
        # 옮기기(있던 획 고치기)
        strokes["moved-stroke-id-000"]["points"] = [9.0, 9.0, 0.5]
        # 새로 그은 획(레이어는 옛 장의 것)
        strokes["fresh-stroke-id-0000"] = Map(pen("a", layer="L1", pts=b"\x01\x02"))
    update = base_doc.get_update(before)

    carried = pages.late_strokes(base, update)

    assert set(carried) == {"fresh-stroke-id-0000"}
    fresh = carried["fresh-stroke-id-0000"]
    assert "layer" not in fresh
    assert fresh["points"] == [1.0, 2.0, 0.5, 3.0, 4.0, 0.5]
    assert fresh["pts"] == b"\x01\x02"


# ── 웹소켓(방이 모아 두던 편집, 봉인 뒤 옛 장으로 온 획) ──────────


@pytest.fixture
def moment(monkeypatch):
    state = {"now": kst(2026, 10, 15, 23, 59, 59)}
    monkeypatch.setattr(clock, "now", lambda: state["now"])
    return state


@sync_to_async
def setup_note(*guest_ids: int):
    owner = login_as(1)
    note_id = create_note(owner)
    guests = []
    for kakao_id in guest_ids:
        guest = login_as(kakao_id)
        guest.get(f"/api/notes/{note_id}")
        guests.append(guest)
    return note_id, owner, guests


@sync_to_async
def page_of(note_id: str, key: str) -> Page:
    date, seq = pages.parse_key(key)
    return Page.objects.get(note_id=note_id, date=date, seq=seq)


@sync_to_async
def strokes_on(note_id: str, key: str) -> dict:
    date, seq = pages.parse_key(key)
    return page_strokes(Page.objects.get(note_id=note_id, date=date, seq=seq).id)


async def next_rolled(y: YClient) -> bytes:
    while True:
        msg = await y.ws.receive_output(timeout=3)
        assert msg["type"] == "websocket.send", msg
        if msg["bytes"][0] == MESSAGE_PAGE_ROLLED:
            return msg["bytes"]
        await y._handle(msg)


async def draw(y: YClient, stroke_id: str, **extra) -> None:
    """y.add_stroke와 같되 점을 정해 준다(새 장에 같은 자리로 갔는지 본다)."""
    from pycrdt import create_update_message

    before = y.doc.get_state()
    y.doc.get("strokes", type=Map)[stroke_id] = Map(pen("a", **extra))
    await y.ws.send_to(bytes_data=create_update_message(y.doc.get_update(before)))


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_edit_held_by_the_room_when_the_seal_runs_lands_on_the_sealed_page(monkeypatch, moment):
    """방이 저장 주기를 기다리던 편집(due_at 전에 받음)은 봉인이 먼저 돌아도 앞 장에 남는다."""
    monkeypatch.setattr(hub, "FLUSH_EVERY", 3600)  # 주기 저장은 시험이 직접 부른다
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    (room,) = hub.hub().rooms.values()
    await draw(a, "edge")
    await until(lambda: room.received == 1)

    moment["now"] = DUE + dt.timedelta(seconds=1)
    page = await page_of(note_id, "2026-10-15")
    assert await sync_to_async(sealing.seal_page)(page.id)
    await room.flush()

    page = await page_of(note_id, "2026-10-15")
    assert set(strokes_of(page.state)) == {"edge"}
    assert page.stroke_count == 1
    await a.close()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_stroke_sent_to_the_old_page_after_due_moves_to_the_new_page(moment):
    """(나) due_at 뒤 옛 장으로 온 획: 앞 장에는 없고 새 장의 같은 자리에 있다. 장이 바뀌었다고 알린다."""
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    (room,) = hub.hub().rooms.values()
    await draw(a, "before")
    await until(lambda: room.saved == 1)
    moment["now"] = DUE + dt.timedelta(milliseconds=100)
    await draw(a, "late", brush="fountain")

    assert b'"key":"2026-10-16"' in await next_rolled(a)
    assert await expect_close(a.ws) == 4409
    old = await page_of(note_id, "2026-10-15")
    assert old.sealed_at is not None
    assert set(strokes_of(old.state)) == {"before"}
    moved = await strokes_on(note_id, "2026-10-16")
    assert set(moved) == {"late"}
    assert moved["late"]["points"] == [1.0, 2.0, 0.5, 3.0, 4.0, 0.5]
    assert moved["late"]["brush"] == "fountain"
    assert moved["late"]["author"] == "a"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_old_page_is_not_closed_first_and_later_strokes_reach_people_on_the_new_page(moment, settings):
    """새 장이 열려 교체를 알린 뒤에도 서버는 옛 장 연결을 먼저 닫지 않는다. 그사이 보낸 획은 새 장 접속자에게 간다."""
    settings.ROLL_CLOSE_AFTER = 30
    note_id, owner, (guest,) = await setup_note(2)
    a = await join(owner, note_id, "2026-10-15")
    moment["now"] = DUE + dt.timedelta(milliseconds=100)
    b = await join(guest, note_id, "2026-10-16")  # 새 장을 열며 앞 장을 봉인하고 교체를 알린다
    assert b'"key":"2026-10-16"' in await next_rolled(a)

    await draw(a, "in-flight")  # 알림이 가는 사이 옛 장에 그었다

    await until_received(b, "in-flight")
    assert "in-flight" in await strokes_on(note_id, "2026-10-16")
    assert "in-flight" not in strokes_of((await page_of(note_id, "2026-10-15")).state)
    await a.close()
    await b.close()


async def until_received(y: YClient, stroke_id: str) -> None:
    while stroke_id not in y.stroke_ids():
        msg = await y.ws.receive_output(timeout=3)
        assert msg["type"] == "websocket.send", msg
        await y._handle(msg)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_edit_held_when_the_owner_moves_the_seal_to_a_passed_hour_moves_to_the_new_page(monkeypatch, moment):
    """주인이 봉인 시각을 이미 지난 시각으로 바꿔 바로 봉인되면, 방이 저장하지 못한(새 봉인 시각 뒤에 받은) 획은
    버리지 않고 새 장으로 옮긴다."""
    monkeypatch.setattr(hub, "FLUSH_EVERY", 3600)  # 주기 저장은 방이 닫힐 때 돈다
    moment["now"] = kst(2026, 10, 16, 23, 30)
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-16")
    (room,) = hub.hub().rooms.values()
    await draw(a, "held")
    await until(lambda: room.received == 1)

    res = await sync_to_async(owner.patch)(f"/api/notes/{note_id}", {"sealHour": 23}, content_type="application/json")
    assert res.json()["page"]["key"] == "2026-10-16-2"
    assert await expect_close(a.ws) == 4409
    await a.close()  # 방이 닫히며 저장을 시도한다

    assert "held" not in strokes_of((await page_of(note_id, "2026-10-16")).state)
    assert "held" in await strokes_on(note_id, "2026-10-16-2")
