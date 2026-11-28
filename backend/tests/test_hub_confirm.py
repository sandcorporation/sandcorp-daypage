"""받았는지 확인(sync step1 → step2)과 저장(#260). 확인은 앞서 받은 편집이 커밋된 뒤에만 나가고, 저장을 늘리지 않는다."""

import datetime as dt
import threading

import pytest
from pycrdt import YMessageType, YSyncMessageType, create_sync_message

from daypage import clock, hub, pages
from tests.test_sync import page_state, setup_note
from tests.waiting import until
from tests.ws import YClient, join

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 15, 15, 0, tzinfo=clock.KST)
DATE = "2026-10-15"


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


def room_of() -> hub.Room:
    (room,) = hub.hub().rooms.values()
    return room


async def check(y: YClient) -> None:
    """클라이언트가 보내는 확인(sync step1)."""
    await y.ws.send_to(bytes_data=create_sync_message(y.doc))


async def next_step2(y: YClient) -> None:
    while True:
        msg = await y.ws.receive_output(timeout=3)
        assert msg["type"] == "websocket.send", msg
        data = msg.get("bytes")
        if data and data[0] == YMessageType.SYNC and data[1] == YSyncMessageType.SYNC_STEP2:
            await y._handle(msg)
            return
        await y._handle(msg)


def no_step2_yet(y: YClient) -> bool:
    return all(
        not (m.get("bytes") and m["bytes"][:2] == bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP2]))
        for m in list(y.ws.output_queue._queue)  # 보낸 것을 꺼내지 않고 본다
    )


async def test_checks_from_many_people_do_not_add_saves(monkeypatch):
    """(가) 여러 연결이 주기보다 잦게 확인을 보내도 저장은 주기 저장으로만 돈다."""
    monkeypatch.setattr(hub, "FLUSH_EVERY", 3600)  # 주기 저장은 시험이 직접 부른다
    calls = []
    real = pages.append_update
    monkeypatch.setattr(pages, "append_update", lambda *a: calls.append(a) or real(*a))
    note_id, owner, guests = await setup_note(2, 3)
    people = [await join(c, note_id, DATE) for c in (owner, *guests)]
    room = room_of()
    for i in range(3):
        for n, y in enumerate(people):
            await y.add_stroke(f"s{n}-{i}")
            await check(y)
    # 각자 마지막 확인 뒤에 하나 더 그린다: 그것까지 받았으면 앞선 확인은 모두 처리됐다(연결마다 받은 차례대로).
    for n, y in enumerate(people):
        await y.add_stroke(f"s{n}-last")
    await until(lambda: room.received == 4 * len(people))
    assert calls == []
    assert all(no_step2_yet(y) for y in people)

    await room.flush()  # 예정된 주기 저장 한 번
    for y in people:
        for _ in range(3):
            await next_step2(y)
    assert len(calls) == 1
    assert len(await page_state(note_id)) == 4 * len(people)
    for y in people:
        await y.close()


async def test_check_during_a_save_is_answered_after_that_save_commits(monkeypatch):
    """(나) 진행 중 저장이 DB를 기다리는 동안 온 확인의 답은 그 저장이 커밋된 뒤에 나간다."""
    monkeypatch.setattr(hub, "FLUSH_EVERY", 0)
    entered, release = threading.Event(), threading.Event()
    committed = []
    real = pages.append_update

    def held_append(*args):
        entered.set()
        release.wait(3)
        count = real(*args)
        committed.append(args)
        return count

    monkeypatch.setattr(pages, "append_update", held_append)
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, DATE)
    room = room_of()
    try:
        await a.add_stroke("first")
        await until(entered.is_set)  # 주기 저장이 DB에서 붙잡혔다
        await check(a)
        await a.add_stroke("after")  # 이것까지 받았으면 확인은 처리됐다
        await until(lambda: room.received == 2)
        assert no_step2_yet(a)
        assert committed == []
    finally:
        release.set()
    await next_step2(a)
    assert len(committed) >= 1
    assert "first" in await page_state(note_id)
    await a.close()


async def test_failed_save_sends_no_check_answer_until_saved(monkeypatch):
    """(다) 저장이 실패하면 그 확인에 답하지 않는다. 편집은 되돌려 놓아 다음 주기에 다시 저장한 뒤에야 답한다."""
    monkeypatch.setattr(hub, "FLUSH_EVERY", 0.01)
    attempts = []
    fixed = threading.Event()
    real = pages.append_update

    def flaky_append(*args):
        attempts.append(args)
        if not fixed.is_set():
            raise RuntimeError("DB 끊김")
        return real(*args)

    monkeypatch.setattr(pages, "append_update", flaky_append)
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, DATE)
    await a.add_stroke("kept")
    await check(a)
    await until(lambda: len(attempts) >= 2)  # 실패했고, 되돌려 놓은 편집으로 다시 시도했다
    assert no_step2_yet(a)
    fixed.set()
    await next_step2(a)
    assert await page_state(note_id) == {"kept"}
    await a.close()
