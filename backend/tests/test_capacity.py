"""수용 인원·대기열·자리 비움. 수용 인원은 설정이 가리키는 cgroup 파일(cpu.max)로 조절한다."""

import asyncio
import contextlib
import datetime as dt
import json

import pytest
from asgiref.sync import sync_to_async
from django.test import Client
from pycrdt import read_message

from daypage import clock
from tests.helpers import create_note, login_as
from tests.ws import YClient, awareness_message, expect_close, join, open_ws

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 15, 15, 0, tzinfo=clock.KST)
DATE = "2026-10-15"


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


@pytest.fixture
def cpu(settings, tmp_path):
    """cpu(0.2) → 이 프로세스의 CPU 제한을 0.2코어로. 계수 10이면 수용 인원 2명."""
    settings.MAX_ONLINE_PER_CORE = 10
    settings.QUEUE_POLL_EVERY = 0.05
    path = tmp_path / "cpu.max"
    settings.CGROUP_CPU_MAX_PATH = str(path)

    def set_cpu(cores: float | None) -> None:
        path.write_text("max 100000\n" if cores is None else f"{round(cores * 100000)} 100000\n")

    return set_cpu


@sync_to_async
def setup_note(people: int):
    """사람 people명이 모두 참여한 노트 하나."""
    owner = login_as(1)
    note_id = create_note(owner)
    clients = [owner]
    for kakao_id in range(2, people + 1):
        guest = login_as(kakao_id)
        guest.get(f"/api/notes/{note_id}")
        clients.append(guest)
    return note_id, clients


def decode_queued(data: bytes) -> dict | None:
    if data and data[0] == 101:
        return json.loads(read_message(data[1:]))
    return None


async def next_position(ws, timeout: float = 3) -> int:
    """다음 대기 순번 메시지를 기다린다."""
    while True:
        msg = await ws.receive_output(timeout=timeout)
        if msg["type"] == "websocket.close":
            raise AssertionError(f"closed: {msg}")
        queued = decode_queued(msg.get("bytes"))
        if queued is not None:
            assert queued["type"] == "queued"
            return queued["position"]
        assert msg["bytes"][0] not in (0, 1), "대기 중에는 문서·커서를 받지 않는다"


async def position_becomes(ws, expected: int, timeout: float = 3) -> None:
    async def wait():
        while await next_position(ws) != expected:
            pass

    await asyncio.wait_for(wait(), timeout)


async def queue(client, note_id: str) -> YClient:
    return YClient(await open_ws(client, note_id, DATE))


async def test_without_cpu_limit_anyone_gets_in(cpu):
    cpu(None)
    note_id, clients = await setup_note(3)
    ys = [await join(c, note_id, DATE) for c in clients]
    for y in ys:
        await y.close()


async def test_unreadable_cgroup_file_means_no_limit(settings):
    settings.MAX_ONLINE_PER_CORE = 1
    settings.CGROUP_CPU_MAX_PATH = "/nonexistent/cpu.max"
    note_id, clients = await setup_note(3)
    ys = [await join(c, note_id, DATE) for c in clients]
    for y in ys:
        await y.close()


async def test_within_capacity_gets_in_and_over_capacity_waits(cpu):
    cpu(0.2)
    note_id, (a, b, c) = await setup_note(3)
    ya = await join(a, note_id, DATE)
    yb = await join(b, note_id, DATE)
    yc = await queue(c, note_id)
    assert await next_position(yc.ws) == 1
    assert await next_position(yc.ws) == 1  # 몇 초마다 다시 알린다
    # 기다리는 사람은 노트 접속자로 세지 않는다
    assert await sync_to_async(lambda: Client().get(f"/api/notes/{note_id}/preview").json()["online"])() == 2
    for y in (ya, yb, yc):
        await y.close()


async def test_waiter_gets_in_when_someone_leaves(cpu):
    cpu(0.2)
    note_id, (a, b, c) = await setup_note(3)
    ya = await join(a, note_id, DATE)
    yb = await join(b, note_id, DATE)
    await ya.add_stroke("s1")
    yc = await queue(c, note_id)
    assert await next_position(yc.ws) == 1
    await ya.close()
    await yc.sync()  # 아무것도 누르지 않아도 같은 연결로 문서를 받는다
    assert yc.stroke_ids() == {"s1"}
    await yb.close()
    await yc.close()


async def test_first_come_first_served(cpu):
    cpu(0.2)
    note_id, (a, b, c, d) = await setup_note(4)
    ya = await join(a, note_id, DATE)
    yb = await join(b, note_id, DATE)
    yc = await queue(c, note_id)
    assert await next_position(yc.ws) == 1
    yd = await queue(d, note_id)
    assert await next_position(yd.ws) == 2
    await ya.close()
    await yc.sync()
    await position_becomes(yd.ws, 1)
    for y in (yb, yc, yd):
        await y.close()


async def test_leaving_the_line_moves_others_up(cpu):
    cpu(0.2)
    note_id, (a, b, c, d) = await setup_note(4)
    ya = await join(a, note_id, DATE)
    yb = await join(b, note_id, DATE)
    yc = await queue(c, note_id)
    assert await next_position(yc.ws) == 1
    yd = await queue(d, note_id)
    assert await next_position(yd.ws) == 2
    await yc.close()
    await position_becomes(yd.ws, 1)
    for y in (ya, yb, yd):
        await y.close()


async def test_new_tab_of_someone_already_in_does_not_wait(cpu):
    cpu(0.2)
    note_id, (a, b, c) = await setup_note(3)
    ya = await join(a, note_id, DATE)
    yb = await join(b, note_id, DATE)
    yc = await queue(c, note_id)
    assert await next_position(yc.ws) == 1
    ya2 = await join(a, note_id, DATE)
    for y in (ya, yb, yc, ya2):
        await y.close()


async def test_full_line_is_refused(cpu):
    cpu(0.1)  # 수용 인원 1명, 대기열도 1명까지
    note_id, (a, b, c) = await setup_note(3)
    ya = await join(a, note_id, DATE)
    yb = await queue(b, note_id)
    assert await next_position(yb.ws) == 1
    ws = await open_ws(c, note_id, DATE)
    assert await expect_close(ws) == 4430
    await ya.close()
    await yb.close()


async def test_note_limit_is_judged_before_capacity(cpu, settings):
    cpu(0.1)
    settings.MAX_CONCURRENT_PER_NOTE = 1
    note_id, (a, b) = await setup_note(2)
    ya = await join(a, note_id, DATE)
    ws = await open_ws(b, note_id, DATE)
    assert await expect_close(ws) == 4429
    await ya.close()


async def test_capacity_counts_people_across_notes(cpu):
    cpu(0.1)
    note_id, (a,) = await setup_note(1)
    other_owner = await sync_to_async(login_as)(2)
    other_note = await sync_to_async(create_note)(other_owner)
    ya = await join(a, note_id, DATE)
    yb = await queue(other_owner, other_note)
    assert await next_position(yb.ws) == 1
    await ya.close()
    await yb.sync()
    await yb.close()


async def test_away_person_is_let_go_for_a_waiter(cpu, settings):
    cpu(0.2)
    settings.AWAY_AFTER = 0.4
    note_id, (a, b, c) = await setup_note(3)
    ya = await join(a, note_id, DATE)
    yb = await join(b, note_id, DATE)
    yc = await queue(c, note_id)
    assert await next_position(yc.ws) == 1

    waiter_in = asyncio.Event()

    async def keep_moving():
        # 자리 비움 판정이 실제 시계(time.time)라서 입력 사이에 시간이 흘러야 한다. 대기자가 들어오면 바로 멈춘다.
        i = 0
        while not waiter_in.is_set():
            i += 1
            await ya.ws.send_to(bytes_data=awareness_message(111, i, {"cursor": {"x": i, "y": 1}}))
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(waiter_in.wait(), 0.1)

    mover = asyncio.create_task(keep_moving())
    assert await expect_close(yb.ws) == 4408  # 아무 입력이 없던 사람
    await yc.sync()  # 그 자리로 대기자가 들어온다
    waiter_in.set()
    await mover
    await ya.drain()
    assert not hasattr(ya, "closed")  # 입력이 있던 사람은 남는다
    await ya.close()
    await yc.close()


async def test_nobody_is_let_go_without_waiters(cpu, settings):
    cpu(0.2)
    settings.AWAY_AFTER = 0.1
    note_id, (a,) = await setup_note(1)
    ya = await join(a, note_id, DATE)
    await ya.drain(timeout=0.4)  # 자리 비움 한도(0.1초)의 몇 배 동안 아무 일도 없어야 한다(안 와야 할 닫기는 짧게 받아 본다)
    assert not hasattr(ya, "closed")
    await ya.close()
