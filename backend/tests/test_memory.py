"""메모리: 닫힌 방이 남지 않고, 방이 닫히면 비운 메모리를 운영체제에 돌려준다."""

import gc
import weakref

import pytest
from pycrdt import Doc

from daypage import hub, memory
from tests.test_hub import TODAY, FakeMember, fixed_clock, load, make_page, settle, stroke_update  # noqa: F401

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]


async def test_closed_room_is_freed_even_after_it_handled_a_message_from_another_process():
    """다른 프로세스 메시지를 받는 루프가 마지막으로 다룬 방을 붙잡고 있으면 닫힌 방의 문서가 안 풀린다."""
    page_id = await make_page()
    one, two = hub.Hub(), hub.Hub()
    a, b = FakeMember(), FakeMember()
    room_one = await one.join(page_id, a, load(page_id))
    room_two = await two.join(page_id, b, load(page_id))
    await settle()
    # one의 루프가 room_one으로 메시지를 다루게 한다
    await room_two.local_update(b, stroke_update(Doc(), "s1"), TODAY)
    await settle()

    ref = weakref.ref(room_one)
    await one.leave(room_one, a)
    del room_one
    await settle()
    gc.collect()
    assert ref() is None
    await two.leave(room_two, b)


async def test_memory_is_returned_when_the_last_person_leaves(monkeypatch):
    calls = []
    monkeypatch.setattr(memory, "release", lambda: calls.append(1))
    page_id = await make_page()
    h = hub.Hub()
    a, b = FakeMember(), FakeMember()
    room = await h.join(page_id, a, load(page_id))
    await h.join(page_id, b, load(page_id))
    await h.leave(room, a)
    assert calls == []  # 아직 한 사람이 남았다
    await h.leave(room, b)
    assert calls == [1]


def test_release_is_rate_limited(monkeypatch):
    trims = []
    monkeypatch.setattr(memory, "_trim", lambda: trims.append(1))
    monkeypatch.setattr(memory, "_last", 0.0)
    now = [1000.0]
    monkeypatch.setattr(memory.time, "monotonic", lambda: now[0])
    memory.release()
    memory.release()
    assert trims == [1]
    now[0] += memory.MIN_INTERVAL + 1
    memory.release()
    assert trims == [1, 1]


def test_trim_is_harmless_where_glibc_is_missing():
    # 윈도·macOS(개발 환경)에서는 아무 일도 하지 않는다
    memory._trim()
