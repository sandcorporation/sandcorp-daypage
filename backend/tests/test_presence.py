import datetime as dt

import pytest
from asgiref.sync import sync_to_async
from django.test import Client

from daypage import clock
from daypage.awareness import decode_message, encode_message
from tests.helpers import create_note, login_as
from tests.ws import awareness_message, expect_close, join, next_awareness, open_ws

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 15, 15, 0, tzinfo=clock.KST)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


@sync_to_async
def setup_note(*guest_ids: int):
    owner = login_as(1)
    note_id = create_note(owner)
    nicknames = {1: owner.get(f"/api/notes/{note_id}").json()["me"]}
    guests = []
    for kakao_id in guest_ids:
        guest = login_as(kakao_id)
        nicknames[kakao_id] = guest.get(f"/api/notes/{note_id}").json()["me"]
        guests.append(guest)
    return note_id, owner, guests, nicknames


async def test_awareness_round_trips_through_encoder():
    entries = [(7, 3, {"nickname": "x", "cursor": {"x": 1, "y": 2}}), (8, 1, None)]
    assert decode_message(encode_message(entries)) == entries


async def test_server_replaces_nickname_and_color_sent_by_client():
    note_id, owner, (guest,), names = await setup_note(2)
    a = await join(owner, note_id, "2026-10-15")
    b = await join(guest, note_id, "2026-10-15")
    await a.ws.send_to(
        bytes_data=awareness_message(111, 1, {"nickname": "가짜 이름", "color": "#000000", "cursor": {"x": 5, "y": 6}})
    )
    [(client_id, _, state)] = await next_awareness(b)
    assert client_id == 111
    assert state["nickname"] == names[1]["nickname"]
    assert state["color"] == names[1]["color"]
    assert state["cursor"] == {"x": 5, "y": 6}
    await a.close()
    await b.close()


async def test_newcomer_receives_existing_presence():
    note_id, owner, (guest,), names = await setup_note(2)
    a = await join(owner, note_id, "2026-10-15")
    await a.ws.send_to(bytes_data=awareness_message(111, 1, {"cursor": None, "editingBoxId": "box1"}))
    await a.sync()
    b = await join(guest, note_id, "2026-10-15")
    [(client_id, _, state)] = await next_awareness(b)
    assert client_id == 111
    assert state["editingBoxId"] == "box1"
    assert state["nickname"] == names[1]["nickname"]
    await a.close()
    await b.close()


async def test_leaving_clears_presence_for_others():
    note_id, owner, (guest,), _ = await setup_note(2)
    a = await join(owner, note_id, "2026-10-15")
    b = await join(guest, note_id, "2026-10-15")
    await a.ws.send_to(bytes_data=awareness_message(111, 4, {"cursor": {"x": 1, "y": 1}}))
    await next_awareness(b)
    await a.close()
    [(client_id, clock_value, state)] = await next_awareness(b)
    assert (client_id, state) == (111, None)
    assert clock_value > 4
    await b.close()


async def test_online_count_reflects_people_in_the_note():
    note_id, owner, (guest,), _ = await setup_note(2)
    preview = sync_to_async(lambda: Client().get(f"/api/notes/{note_id}/preview").json()["online"])
    assert await preview() == 0
    a = await join(owner, note_id, "2026-10-15")
    b = await join(guest, note_id, "2026-10-15")
    assert await preview() == 2
    await a.close()
    assert await preview() == 1
    await b.close()


async def test_same_person_in_two_tabs_counts_once():
    note_id, owner, _, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    a2 = await join(owner, note_id, "2026-10-15")
    assert await sync_to_async(lambda: Client().get(f"/api/notes/{note_id}/preview").json()["online"])() == 1
    await a.close()
    await a2.close()


async def test_connection_over_the_concurrent_limit_is_refused(settings):
    settings.MAX_CONCURRENT_PER_NOTE = 2
    note_id, owner, (g1, g2), _ = await setup_note(2, 3)
    a = await join(owner, note_id, "2026-10-15")
    b = await join(g1, note_id, "2026-10-15")
    ws = await open_ws(g2, note_id, "2026-10-15")
    assert await expect_close(ws) == 4429
    await a.close()
    await b.close()
