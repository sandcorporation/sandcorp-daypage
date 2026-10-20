"""노트 종이가 바뀌면 그 노트에 접속한 사람에게 메시지 103으로 알린다."""

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


async def next_paper(ws, timeout: float = 3) -> dict:
    while True:
        msg = await ws.receive_output(timeout=timeout)
        assert msg["type"] == "websocket.send", msg
        data = msg.get("bytes")
        if data and data[0] == 103:
            payload = json.loads(read_message(data[1:]))
            assert payload["type"] == "note_paper"
            return payload["paper"]


async def test_connected_people_see_the_new_paper():
    owner = await sync_to_async(login_as)(1)
    note_id = await sync_to_async(create_note)(owner)
    guest = await sync_to_async(login_as)(2)
    await sync_to_async(guest.get)(f"/api/notes/{note_id}")
    y = await join(guest, note_id, "2026-10-16")

    patch = sync_to_async(owner.patch)
    await patch(f"/api/notes/{note_id}/paper", {"pattern": "dot", "color": "cream"}, content_type="application/json")
    assert await next_paper(y.ws) == {"pattern": "dot", "margin": True, "color": "cream"}
    await y.close()
