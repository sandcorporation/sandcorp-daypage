"""노트 이름·참여 수·정원이 바뀌면 그 노트에 접속한 사람에게 메시지 105로 알린다(#174)."""

import datetime as dt
import json

import pytest
from asgiref.sync import sync_to_async
from pycrdt import read_message

from daypage import clock
from daypage.models import NoteBan, NoteMember
from tests.helpers import create_note, login_as
from daypage import membership
from tests.ws import YClient, join, open_ws

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 16, 15, 0, tzinfo=clock.KST)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


async def next_info(ws, timeout: float = 3) -> dict:
    while True:
        msg = await ws.receive_output(timeout=timeout)
        assert msg["type"] == "websocket.send", msg
        data = msg.get("bytes")
        if data and data[0] == 105:
            payload = json.loads(read_message(data[1:]))
            assert payload.pop("type") == "note_info"
            assert isinstance(payload.pop("seq"), int)
            return payload


async def connected_note():
    """주인이 만든 노트에 손님 하나가 접속해 있다."""
    owner = await sync_to_async(login_as)(1)
    note_id = await sync_to_async(create_note)(owner, memberLimit=4)
    guest = await sync_to_async(login_as)(2)
    await sync_to_async(guest.get)(f"/api/notes/{note_id}")
    y = await join(guest, note_id, "2026-10-16")
    return owner, note_id, y


async def test_rename_reaches_connected_people():
    owner, note_id, y = await connected_note()
    patch = sync_to_async(owner.patch)
    await patch(f"/api/notes/{note_id}", {"name": "새 이름"}, content_type="application/json")
    assert await next_info(y.ws) == {"name": "새 이름", "memberCount": 2, "memberLimit": 4}
    await y.close()


async def test_new_member_count_reaches_connected_people():
    owner, note_id, y = await connected_note()
    newcomer = await sync_to_async(login_as)(3)
    await sync_to_async(newcomer.get)(f"/api/notes/{note_id}")
    info = await next_info(y.ws)
    assert info["memberCount"] == 3
    await y.close()


async def test_kick_member_count_reaches_connected_people():
    owner, note_id, y = await connected_note()
    newcomer = await sync_to_async(login_as)(3)
    await sync_to_async(newcomer.get)(f"/api/notes/{note_id}")
    assert (await next_info(y.ws))["memberCount"] == 3
    member = await NoteMember.objects.aget(note_id=note_id, user__kakao_id=3)
    await sync_to_async(owner.post)(f"/api/notes/{note_id}/members/{member.pk}/kick")
    assert (await next_info(y.ws))["memberCount"] == 2
    await y.close()


async def test_allowing_again_reaches_connected_people():
    # 참여 수는 그대로지만, 열어 둔 참여자 창이 「내보낸 사람」 목록을 다시 읽어야 한다(#197)
    owner, note_id, y = await connected_note()
    newcomer = await sync_to_async(login_as)(3)
    await sync_to_async(newcomer.get)(f"/api/notes/{note_id}")
    assert (await next_info(y.ws))["memberCount"] == 3
    member = await NoteMember.objects.aget(note_id=note_id, user__kakao_id=3)
    await sync_to_async(owner.post)(f"/api/notes/{note_id}/members/{member.pk}/kick")
    assert (await next_info(y.ws))["memberCount"] == 2
    ban = await NoteBan.objects.aget(note_id=note_id)
    res = await sync_to_async(owner.delete)(f"/api/notes/{note_id}/kicked/{ban.pk}")
    assert res.status_code == 204
    assert await next_info(y.ws) == {"name": "이름 없는 노트", "memberCount": 2, "memberLimit": 4}
    await y.close()


async def test_returning_member_sends_nothing():
    owner, note_id, y = await connected_note()
    await sync_to_async(owner.get)(f"/api/notes/{note_id}")
    patch = sync_to_async(owner.patch)
    await patch(f"/api/notes/{note_id}", {"name": "다음"}, content_type="application/json")
    # 다시 들어온 주인은 알림을 만들지 않으므로 처음 받는 105는 이름 변경이다.
    assert (await next_info(y.ws))["name"] == "다음"
    await y.close()


async def test_joining_the_group_sends_current_info_missed_before():
    # 페이지를 읽은 뒤 노트 그룹에 들기 전에 나간 입장 알림은 받을 수 없다. 그룹에 든 뒤 지금 값을 받는다(#222).
    owner = await sync_to_async(login_as)(1)
    note_id = await sync_to_async(create_note)(owner, memberLimit=8)
    guest = await sync_to_async(login_as)(2)
    await sync_to_async(guest.get)(f"/api/notes/{note_id}")
    for kakao_id in (3, 4, 5):  # 아직 아무도 접속하지 않았을 때 들어온 사람들
        late = await sync_to_async(login_as)(kakao_id)
        await sync_to_async(late.get)(f"/api/notes/{note_id}")
    ws = await open_ws(guest, note_id, "2026-10-16")
    assert await next_info(ws) == {"name": "이름 없는 노트", "memberCount": 5, "memberLimit": 8}
    await YClient(ws).close()


async def test_later_read_gets_larger_seq():
    # 알림이 거꾸로 와도 화면이 판으로 가릴 수 있게, 나중에 읽은 값의 판이 더 크다(#222).
    owner = await sync_to_async(login_as)(1)
    note_id = await sync_to_async(create_note)(owner)
    first = await sync_to_async(membership.current_info)(note_id)
    newcomer = await sync_to_async(login_as)(2)
    await sync_to_async(newcomer.get)(f"/api/notes/{note_id}")
    second = await sync_to_async(membership.current_info)(note_id)
    assert (first["memberCount"], second["memberCount"]) == (1, 2)
    assert second["seq"] > first["seq"]
