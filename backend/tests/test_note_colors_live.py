"""노트 색이 바뀌면 그 노트에 접속한 사람에게 메시지 102로 알린다."""

import datetime as dt
import json

import pytest
from asgiref.sync import sync_to_async
from pycrdt import read_message

from daypage import clock
from tests.helpers import create_note, login_as
from tests.ws import join

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 16, 15, 0, tzinfo=clock.KST)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


async def next_note_colors(ws, timeout: float = 3) -> list[str]:
    while True:
        msg = await ws.receive_output(timeout=timeout)
        assert msg["type"] == "websocket.send", msg
        data = msg.get("bytes")
        if data and data[0] == 102:
            payload = json.loads(read_message(data[1:]))
            assert payload["type"] == "note_colors"
            return payload["colors"]


async def test_connected_people_hear_about_added_and_removed_colors():
    owner = await sync_to_async(login_as)(1)
    note_id = await sync_to_async(create_note)(owner)
    guest = await sync_to_async(login_as)(2)
    await sync_to_async(guest.get)(f"/api/notes/{note_id}")
    y = await join(guest, note_id, "2026-10-16")

    post = sync_to_async(owner.post)
    await post(f"/api/notes/{note_id}/colors", {"color": "#16794F"}, content_type="application/json")
    assert await next_note_colors(y.ws) == ["#16794f"]

    await sync_to_async(owner.delete)(f"/api/notes/{note_id}/colors/16794f")
    assert await next_note_colors(y.ws) == []
    await y.close()
