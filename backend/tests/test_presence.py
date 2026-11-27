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


async def test_limit_counts_people_not_tabs(settings):
    settings.MAX_CONCURRENT_PER_NOTE = 2
    note_id, owner, (g1, g2), _ = await setup_note(2, 3)
    a = await join(owner, note_id, "2026-10-15")
    b = await join(g1, note_id, "2026-10-15")
    # 이미 들어와 있는 사람의 새 탭(새로고침·재연결 포함)은 받는다.
    a2 = await join(owner, note_id, "2026-10-15")
    a3 = await join(owner, note_id, "2026-10-15")
    ws = await open_ws(g2, note_id, "2026-10-15")
    assert await expect_close(ws) == 4429
    for y in (a, b, a2, a3):
        await y.close()


async def test_leaving_clears_only_own_presence_not_echoed_ones():
    """#228 y-websocket은 받은 남의 커서도 되돌려 보낸다. 되돌려 보낸 연결이 나가도 그 사람은 지워지지 않는다."""
    note_id, owner, (g1, g2), _ = await setup_note(2, 3)
    a = await join(owner, note_id, "2026-10-15")
    b = await join(g1, note_id, "2026-10-15")
    c = await join(g2, note_id, "2026-10-15")
    await a.ws.send_to(bytes_data=awareness_message(111, 1, {"cursor": None}))
    assert [e[0] for e in await next_awareness(c)] == [111]
    await b.ws.send_to(bytes_data=awareness_message(222, 3, {"cursor": {"x": 1, "y": 1}}))
    assert [e[0] for e in await next_awareness(c)] == [222]
    # A가 B의 상태를 되돌려 보낸 뒤 나간다
    await a.ws.send_to(bytes_data=awareness_message(222, 3, {"cursor": {"x": 1, "y": 1}}))
    await a.close()
    [(client_id, clock_value, state)] = await next_awareness(c)
    assert (client_id, state) == (111, None)
    assert clock_value > 1
    await b.close()
    await c.close()


async def test_connection_cannot_change_or_clear_another_clients_presence():
    """#228 남의 clientID로 보낸 닉네임·커서·지움은 퍼지지 않는다(처음 보낸 것이 남의 것이어도 가로채지 못한다)."""
    note_id, owner, (g1, g2), names = await setup_note(2, 3)
    b = await join(g1, note_id, "2026-10-15")
    c = await join(g2, note_id, "2026-10-15")
    await b.ws.send_to(bytes_data=awareness_message(222, 3, {"cursor": None}))
    assert [e[0] for e in await next_awareness(c)] == [222]
    a = await join(owner, note_id, "2026-10-15")
    await next_awareness(a)  # 들어올 때 받는 지금 커서
    await a.ws.send_to(bytes_data=awareness_message(222, 4, {"nickname": "가짜", "cursor": {"x": 9, "y": 9}}))
    await a.ws.send_to(bytes_data=awareness_message(111, 1, {"cursor": None}))
    await a.ws.send_to(bytes_data=awareness_message(222, 5, None))
    await a.ws.send_to(bytes_data=awareness_message(111, 2, {"cursor": {"x": 2, "y": 2}}))
    got = await next_awareness(c)
    while got[-1][1] < 2:
        got += await next_awareness(c)
    assert {cid for cid, _, _ in got} == {111}
    assert got[-1][2]["nickname"] == names[1]["nickname"]
    for y in (a, b, c):
        await y.close()
