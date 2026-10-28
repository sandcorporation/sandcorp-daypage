"""연결 유지: 혼자 있는 연결이 끊기지 않게 하고, 이미 끊긴 연결을 조용히 정리한다."""

import asyncio
import datetime as dt

import pytest
from asgiref.sync import sync_to_async
from uvicorn.protocols.utils import ClientDisconnected

from daypage import awareness, clock, consumers, hub, rooms
from tests.helpers import create_note, login_as
from tests.waiting import until
from tests.ws import join

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 15, 15, 0, tzinfo=clock.KST)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


@sync_to_async
def setup_note():
    owner = login_as(1)
    return create_note(owner), owner


async def test_idle_connection_gets_keepalive_that_changes_no_one(monkeypatch):
    """y-websocket은 30초 동안 아무것도 받지 못하면 끊고 다시 붙는다. 혼자 있으면 서버가 보낼 것이 없으므로
    한가할 때 빈 awareness를 보낸다(아무의 커서도 바뀌지 않는다)."""
    monkeypatch.setattr(consumers, "KEEPALIVE_EVERY", 0.2)
    note_id, owner = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    a.awareness.clear()
    msg = await a.ws.receive_output(timeout=2)
    assert msg["bytes"] == consumers.KEEPALIVE
    assert awareness.decode_message(msg["bytes"]) == []
    await a.close()


class _Dead(consumers.PageConsumer):
    """이미 떠난 클라이언트: 무엇을 보내든(데이터·닫기) uvicorn처럼 ClientDisconnected를 낸다."""

    def __init__(self):
        self.outbox = asyncio.Queue(1)
        self.page_id = 1
        self.closing = False
        self.closes = 0

    async def base_send(self, message):
        if message["type"] == "websocket.close":
            self.closes += 1
        raise ClientDisconnected()


async def test_sending_to_a_gone_client_does_not_raise():
    """떠난 클라이언트에 보내다 난 오류가 연결 처리(consumer)를 죽이면 정리(disconnect)가 돌지 않는다."""
    c = _Dead()
    await c.send(bytes_data=b"x")
    assert c.closing


async def test_backed_up_connection_is_closed_once_and_quietly():
    c = _Dead()
    c.push(b"a")  # 자리를 채운다
    for _ in range(5):
        c.push(b"b")  # 넘친다: 처음 한 번만 닫는다
    await until(lambda: c.closes >= 1)  # 닫기 작업이 돌 때까지. 이미 닫는 중이라 더 만들어지지 않는다
    assert c.closes == 1
    assert c.closing


async def test_closing_an_already_gone_client_does_not_raise():
    c = _Dead()
    await c.close(code=consumers.CLOSE_TOO_SLOW)
    assert c.closing
    # 닫기 시작한 연결에는 더 보내지 않는다(넘쳐도 다시 닫지 않는다)
    c.push(b"a")
    c.push(b"b")  # 닫는 중이면 push 는 동기로 돌아온다: 기다릴 작업이 생기지 않는다
    assert c.closes == 1


async def test_crashed_connection_still_leaves_room_and_online_list(monkeypatch):
    """연결 처리 중 예상 못 한 오류로 consumer가 죽어도 방·접속 목록에서 빠진다(남으면 메모리와 인원이 샌다)."""
    note_id, owner = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    assert len(hub.hub().rooms) == 1
    assert len(await rooms.registry().connections(note_id)) == 1

    async def boom(self, text_data=None, bytes_data=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(consumers.PageConsumer, "receive", boom)
    await a.ws.send_to(bytes_data=b"\x00\x00")
    with pytest.raises(RuntimeError):
        await a.ws.wait(timeout=3)
    assert hub.hub().rooms == {}
    assert await rooms.registry().connections(note_id) == []
