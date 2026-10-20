"""운영 조치는 접속해 있는 사람에게 바로 닿는다: 닫힌 노트(4410), 정지된 사용자(4403), 내보낸 참여자(4411)."""

import datetime as dt

import pytest
from asgiref.sync import sync_to_async

from daypage import clock
from daypage.models import User
from tests.helpers import create_note, login_as
from tests.ws import expect_close, join, open_ws

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 16, 15, 0, tzinfo=clock.KST)
DATE = "2026-10-16"


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


def _staff():
    client = login_as(900)
    User.objects.filter(kakao_id=900).update(is_staff=True)
    return client


async def setup():
    owner = await sync_to_async(login_as)(1)
    note_id = await sync_to_async(create_note)(owner)
    guest = await sync_to_async(login_as)(2)
    await sync_to_async(guest.get)(f"/api/notes/{note_id}")
    admin = await sync_to_async(_staff)()
    return owner, guest, admin, note_id


async def test_closing_a_note_disconnects_everyone_in_it():
    owner, guest, admin, note_id = await setup()
    y = await join(guest, note_id, DATE)
    await sync_to_async(admin.post)(f"/api/admin/notes/{note_id}/close", {"reason": "광고"}, content_type="application/json")
    assert await expect_close(y.ws) == 4410
    # 다시 접속해도 닫힌 채
    ws = await open_ws(guest, note_id, DATE)
    assert await expect_close(ws) == 4410


async def test_suspending_a_user_disconnects_them():
    owner, guest, admin, note_id = await setup()
    y = await join(guest, note_id, DATE)
    uid = await sync_to_async(lambda: User.objects.get(kakao_id=2).id)()
    await sync_to_async(admin.post)(f"/api/admin/users/{uid}/suspend", {"days": 1, "reason": "욕설"}, content_type="application/json")
    assert await expect_close(y.ws) == 4403
    ws = await open_ws(guest, note_id, DATE)
    assert await expect_close(ws) == 4403


async def test_kicked_member_is_disconnected_and_cannot_rejoin():
    owner, guest, admin, note_id = await setup()
    y = await join(guest, note_id, DATE)
    members = (await sync_to_async(owner.get)(f"/api/notes/{note_id}/members")).json()["members"]
    await sync_to_async(owner.post)(f"/api/notes/{note_id}/members/{members[1]['id']}/kick")
    assert await expect_close(y.ws) == 4411
    ws = await open_ws(guest, note_id, DATE)
    assert await expect_close(ws) == 4411
