import datetime as dt

import pytest
from asgiref.sync import sync_to_async
from pycrdt import Doc, Map

from daypage import clock
from daypage.models import Page, PageUpdate
from tests.helpers import create_note, login_as
from tests.ws import expect_close, join, open_ws

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 15, 15, 0, tzinfo=clock.KST)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    state = {"now": TODAY}
    monkeypatch.setattr(clock, "now", lambda: state["now"])
    return state


@sync_to_async
def setup_note(*guest_ids: int):
    owner = login_as(1)
    note_id = create_note(owner)
    guests = []
    for kakao_id in guest_ids:
        guest = login_as(kakao_id)
        guest.get(f"/api/notes/{note_id}")
        guests.append(guest)
    return note_id, owner, guests


@sync_to_async
def page_state(note_id: str) -> set[str]:
    page = Page.objects.get(note_id=note_id, date=TODAY.date())
    doc = Doc()
    if page.state:
        doc.apply_update(bytes(page.state))
    for u in PageUpdate.objects.filter(page=page).order_by("id"):
        doc.apply_update(bytes(u.update))
    return set(doc.get("strokes", type=Map).keys())


@sync_to_async
def update_count(note_id: str) -> int:
    return PageUpdate.objects.filter(page__note_id=note_id).count()


async def test_stroke_from_one_browser_reaches_the_other_and_is_saved():
    note_id, owner, (guest,) = await setup_note(2)
    a = await join(owner, note_id, "2026-10-15")
    b = await join(guest, note_id, "2026-10-15")
    await a.add_stroke("s1")
    await a.sync()
    await b.drain()
    assert b.stroke_ids() == {"s1"}
    assert await page_state(note_id) == {"s1"}
    await a.close()
    await b.close()


async def test_content_survives_reconnect_like_a_server_restart():
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    await a.add_stroke("kept")
    await a.sync()
    await a.close()
    again = await join(owner, note_id, "2026-10-15")
    assert again.stroke_ids() == {"kept"}
    await again.close()


async def test_non_member_is_closed_with_4401():
    note_id, _, _ = await setup_note()
    stranger = await sync_to_async(login_as)(9)
    ws = await open_ws(stranger, note_id, "2026-10-15")
    assert await expect_close(ws) == 4401


async def test_anonymous_is_closed_with_4401():
    note_id, _, _ = await setup_note()
    ws = await open_ws(None, note_id, "2026-10-15")
    assert await expect_close(ws) == 4401


async def test_yesterday_page_is_closed_with_4409():
    note_id, owner, _ = await setup_note()
    ws = await open_ws(owner, note_id, "2026-10-14")
    assert await expect_close(ws) == 4409


async def test_unknown_note_is_closed_with_4404():
    owner = await sync_to_async(login_as)(1)
    ws = await open_ws(owner, "nope", "2026-10-15")
    assert await expect_close(ws) == 4404


async def test_foreign_origin_is_rejected():
    note_id, owner, _ = await setup_note()
    from channels.testing import WebsocketCommunicator

    from config.asgi import application
    from tests.ws import session_cookie

    ws = WebsocketCommunicator(
        application,
        f"/ws/notes/{note_id}/pages/2026-10-15",
        headers=[(b"origin", b"https://evil.example"), (b"host", b"localhost"), (b"cookie", session_cookie(owner))],
    )
    connected, _ = await ws.connect(timeout=3)
    assert not connected


async def test_update_received_after_midnight_is_dropped(fixed_clock):
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    fixed_clock["now"] = dt.datetime(2026, 10, 16, 0, 0, 1, tzinfo=clock.KST)
    await a.add_stroke("late")
    assert await expect_close(a.ws) == 4409
    assert "late" not in await page_state(note_id)


async def test_update_to_sealed_page_is_dropped():
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    await sync_to_async(Page.objects.filter(note_id=note_id).update)(sealed_at=TODAY)
    await a.add_stroke("sealed")
    assert await expect_close(a.ws) == 4409
    assert "sealed" not in await page_state(note_id)


async def test_updates_are_compacted_into_snapshot(settings):
    settings.COMPACT_EVERY = 20
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    for i in range(25):
        await a.add_stroke(f"s{i}")
    await a.sync()  # 서버는 메시지를 순서대로 처리하므로 sync 응답이 오면 앞의 update도 끝났다.
    assert await update_count(note_id) < 20
    assert await page_state(note_id) == {f"s{i}" for i in range(25)}
    await a.close()


async def test_room_is_compacted_when_last_person_leaves():
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    await a.add_stroke("x")
    await a.sync()
    await a.close()
    assert await update_count(note_id) == 0
    assert await page_state(note_id) == {"x"}
