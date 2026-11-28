"""장이 바뀌는 순간 그린 것(#266, #268). 행선 규칙의 전이표는 test_sealing_boundary.py.

- 장이 닫히기 전에 받은 편집은 서버가 모아 두던 사이 봉인이 먼저 돌았어도 앞 장에 남는다.
- 닫힌 뒤 옛 장으로 온 편집은 앞 장에 넣지 않는다. 새로 만든 것(획·글 상자·사진)과 옮긴 것을 고친 것은 새 장의
  같은 자리로 옮기고, 앞 장에 남은 것을 고친 것은 버리고 그 수를 알린다.
"""

import asyncio
import datetime as dt
import json
import threading

import pytest
from asgiref.sync import sync_to_async
from django.db import connection
from pycrdt import Doc, Map, XmlElement, XmlFragment, XmlText, create_update_message

from daypage import clock, hub, pages, sealing
from daypage.consumers import MESSAGE_EDITS_LOST, MESSAGE_PAGE_ROLLED
from daypage.models import Note, Page, PageUpdate, Photo
from tests.helpers import create_note, login_as
from tests.waiting import until, until_sync
from tests.ws import YClient, expect_close, join

YESTERDAY = dt.date(2026, 10, 15)


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


DUE = kst(2026, 10, 16)
JUST_BEFORE = DUE - dt.timedelta(milliseconds=200)


def stroke_update(strokes: dict[str, dict]) -> bytes:
    doc = Doc()
    s = doc.get("strokes", type=Map)
    for sid, fields in strokes.items():
        s[sid] = Map(fields)
    return doc.get_update()


def pen(author: str, **extra) -> dict:
    return {"tool": "pen", "author": author, "points": [1.0, 2.0, 0.5, 3.0, 4.0, 0.5], **extra}


def strokes_of(state: bytes) -> dict:
    doc = Doc()
    doc.apply_update(bytes(state))
    return doc.get("strokes", type=Map).to_py()


def page_strokes(page_id: int) -> dict:
    doc = pages.load_doc(page_id)
    return doc.get("strokes", type=Map).to_py()


@pytest.fixture
def note(db):
    return Note.objects.get(pk=create_note(login_as(1)))


@pytest.fixture
def at(monkeypatch):
    def set_now(moment: dt.datetime):
        monkeypatch.setattr(clock, "now", lambda: moment)

    return set_now


# ── 저장 경로(pages.append_update) ──────────────────────────────


def test_edit_received_before_due_lands_on_page_sealed_first(note, at):
    """(가) 봉인이 먼저 돈 뒤 due_at 전에 받은 묶음이 저장되면 앞 장에 들어가고, 숫자도 그것까지 센다."""
    page = pages.get_or_create_page(note, YESTERDAY)
    PageUpdate.objects.create(page=page, update=stroke_update({"s1": pen("졸린 수달")}))
    at(DUE + dt.timedelta(seconds=1))
    sealing.seal_page(page.id)

    pages.append_update(page.id, stroke_update({"s2": pen("푸른 펭귄")}), JUST_BEFORE)

    page.refresh_from_db()
    strokes = strokes_of(page.state)
    assert set(strokes) == {"s1", "s2"}
    # 봉인 때처럼 점을 바이너리로 다시 쓴다
    assert "pts" in strokes["s2"] and "points" not in strokes["s2"]
    assert (page.stroke_count, page.participant_count, page.is_empty) == (2, 2, False)
    assert PageUpdate.objects.filter(page=page).count() == 0


def test_empty_sealed_page_with_a_late_stroke_shows_in_the_record(note, at):
    page = pages.get_or_create_page(note, YESTERDAY)
    at(DUE + dt.timedelta(seconds=1))
    sealing.seal_page(page.id)
    page.refresh_from_db()
    assert page.is_empty

    pages.append_update(page.id, stroke_update({"s1": pen("졸린 수달")}), JUST_BEFORE)

    assert [p.id for p, _, _ in pages.recorded_pages(note)] == [page.id]


@pytest.mark.parametrize("sealed", [False, True])
def test_edit_received_at_or_after_due_does_not_enter_the_page(note, at, sealed):
    """(나) due_at 뒤에 받은 것은 봉인 전이든 뒤든 앞 장에 들어가지 않는다."""
    page = pages.get_or_create_page(note, YESTERDAY)
    if sealed:
        at(DUE + dt.timedelta(seconds=1))
        sealing.seal_page(page.id)
    before = bytes(Page.objects.get(pk=page.id).state)

    with pytest.raises(pages.PageSealed):
        pages.append_update(page.id, stroke_update({"late": pen("a")}), DUE)

    assert bytes(Page.objects.get(pk=page.id).state) == before
    assert PageUpdate.objects.filter(page=page).count() == 0


@pytest.mark.django_db(transaction=True)
def test_save_waiting_on_the_seal_lock_is_not_lost(monkeypatch):
    """(다) 봉인이 행 잠금을 쥔 동안 온 저장은 잠금을 기다렸다가 봉인된 장에 들어간다."""
    note = Note.objects.get(pk=create_note(login_as(1)))
    page = pages.get_or_create_page(note, YESTERDAY)
    PageUpdate.objects.create(page=page, update=stroke_update({"s1": pen("졸린 수달")}))
    monkeypatch.setattr(clock, "now", lambda: DUE + dt.timedelta(seconds=1))
    holding, release = threading.Event(), threading.Event()
    real_merge = sealing._merge

    def held_merge(p):
        holding.set()
        release.wait(5)
        return real_merge(p)

    monkeypatch.setattr(sealing, "_merge", held_merge)
    errors: list[BaseException] = []

    def run(fn):
        try:
            fn()
        except BaseException as e:  # 스레드 안의 실패를 시험으로 넘긴다
            errors.append(e)
        finally:
            connection.close()

    sealer = threading.Thread(target=run, args=(lambda: sealing.seal_page(page.id),))
    saver = threading.Thread(
        target=run, args=(lambda: pages.append_update(page.id, stroke_update({"s2": pen("푸른 펭귄")}), JUST_BEFORE),)
    )
    sealer.start()
    try:
        assert holding.wait(5)
        saver.start()
        # 저장이 봉인의 행 잠금을 기다리기 시작했다
        until_sync(lambda: _lock_waiters() > 0)
    finally:
        release.set()
    sealer.join(5)
    saver.join(5)
    assert errors == []

    page.refresh_from_db()
    assert page.sealed_at is not None
    assert set(strokes_of(page.state)) == {"s1", "s2"}
    assert page.stroke_count == 2


def _lock_waiters() -> int:
    with connection.cursor() as cursor:
        cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
        return cursor.fetchone()[0]


# ── 웹소켓(방이 모아 두던 편집, 봉인 뒤 옛 장으로 온 획) ──────────


@pytest.fixture
def moment(monkeypatch):
    state = {"now": kst(2026, 10, 15, 23, 59, 59)}
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
def page_of(note_id: str, key: str) -> Page:
    date, seq = pages.parse_key(key)
    return Page.objects.get(note_id=note_id, date=date, seq=seq)


@sync_to_async
def strokes_on(note_id: str, key: str) -> dict:
    date, seq = pages.parse_key(key)
    return page_strokes(Page.objects.get(note_id=note_id, date=date, seq=seq).id)


async def next_rolled(y: YClient) -> bytes:
    while True:
        msg = await y.ws.receive_output(timeout=3)
        assert msg["type"] == "websocket.send", msg
        if msg["bytes"][0] == MESSAGE_PAGE_ROLLED:
            return msg["bytes"]
        await y._handle(msg)


async def draw(y: YClient, stroke_id: str, **extra) -> None:
    """y.add_stroke와 같되 점을 정해 준다(새 장에 같은 자리로 갔는지 본다)."""
    from pycrdt import create_update_message

    before = y.doc.get_state()
    y.doc.get("strokes", type=Map)[stroke_id] = Map(pen("a", **extra))
    await y.ws.send_to(bytes_data=create_update_message(y.doc.get_update(before)))


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_edit_held_by_the_room_when_the_seal_runs_lands_on_the_sealed_page(monkeypatch, moment):
    """방이 저장 주기를 기다리던 편집(due_at 전에 받음)은 봉인이 먼저 돌아도 앞 장에 남는다."""
    monkeypatch.setattr(hub, "FLUSH_EVERY", 3600)  # 주기 저장은 시험이 직접 부른다
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    (room,) = hub.hub().rooms.values()
    await draw(a, "edge")
    await until(lambda: room.received == 1)

    moment["now"] = DUE + dt.timedelta(seconds=1)
    page = await page_of(note_id, "2026-10-15")
    assert await sync_to_async(sealing.seal_page)(page.id)
    await room.flush()

    page = await page_of(note_id, "2026-10-15")
    assert set(strokes_of(page.state)) == {"edge"}
    assert page.stroke_count == 1
    await a.close()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_stroke_sent_to_the_old_page_after_due_moves_to_the_new_page(moment):
    """(나) due_at 뒤 옛 장으로 온 획: 앞 장에는 없고 새 장의 같은 자리에 있다. 장이 바뀌었다고 알린다."""
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    (room,) = hub.hub().rooms.values()
    await draw(a, "before")
    await until(lambda: room.saved == 1)
    moment["now"] = DUE + dt.timedelta(milliseconds=100)
    await draw(a, "late", brush="fountain")

    assert b'"key":"2026-10-16"' in await next_rolled(a)
    assert await expect_close(a.ws) == 4409
    old = await page_of(note_id, "2026-10-15")
    assert old.sealed_at is not None
    assert set(strokes_of(old.state)) == {"before"}
    moved = await strokes_on(note_id, "2026-10-16")
    assert set(moved) == {"late"}
    assert moved["late"]["points"] == [1.0, 2.0, 0.5, 3.0, 4.0, 0.5]
    assert moved["late"]["brush"] == "fountain"
    assert moved["late"]["author"] == "a"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_old_page_is_not_closed_first_and_later_strokes_reach_people_on_the_new_page(moment, settings):
    """새 장이 열려 교체를 알린 뒤에도 서버는 옛 장 연결을 먼저 닫지 않는다. 그사이 보낸 획은 새 장 접속자에게 간다."""
    settings.ROLL_CLOSE_AFTER = 30
    note_id, owner, (guest,) = await setup_note(2)
    a = await join(owner, note_id, "2026-10-15")
    moment["now"] = DUE + dt.timedelta(milliseconds=100)
    b = await join(guest, note_id, "2026-10-16")  # 새 장을 열며 앞 장을 봉인하고 교체를 알린다
    assert b'"key":"2026-10-16"' in await next_rolled(a)

    await draw(a, "in-flight")  # 알림이 가는 사이 옛 장에 그었다

    await until_received(b, "in-flight")
    assert "in-flight" in await strokes_on(note_id, "2026-10-16")
    assert "in-flight" not in strokes_of((await page_of(note_id, "2026-10-15")).state)
    await a.close()
    await b.close()


async def until_received(y: YClient, stroke_id: str) -> None:
    while stroke_id not in y.stroke_ids():
        msg = await y.ws.receive_output(timeout=3)
        assert msg["type"] == "websocket.send", msg
        await y._handle(msg)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
@pytest.mark.parametrize(("seal_after", "lands_on"), [(dt.timedelta(seconds=1), "2026-10-16"), (dt.timedelta(0), "2026-10-16-2")])
async def test_edit_held_when_the_owner_moves_the_seal_to_a_passed_hour(monkeypatch, moment, seal_after, lands_on):
    """(3) 주인이 봉인 시각을 이미 지난 시각으로 바꿔 바로 봉인하면 그 장은 sealed_at까지 열려 있었다. 방이 모아 두던 편집은
    받은 시각이 봉인 전이면 앞 장에, 봉인 순간이나 뒤면 새 장에 남는다(어느 쪽이든 버리지 않는다)."""
    monkeypatch.setattr(hub, "FLUSH_EVERY", 3600)  # 주기 저장은 방이 닫힐 때 돈다
    moment["now"] = kst(2026, 10, 16, 23, 30)
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-16")
    (room,) = hub.hub().rooms.values()
    await draw(a, "held")
    await until(lambda: room.received == 1)

    moment["now"] += seal_after
    res = await sync_to_async(owner.patch)(f"/api/notes/{note_id}", {"sealHour": 23}, content_type="application/json")
    assert res.json()["page"]["key"] == "2026-10-16-2"
    assert await expect_close(a.ws) == 4409
    await a.close()  # 방이 닫히며 저장을 시도한다

    old = await page_of(note_id, "2026-10-16")
    on_old = "held" in strokes_of(old.state)
    on_new = "held" in await strokes_on(note_id, "2026-10-16-2")
    assert (on_old, on_new) == (lands_on == "2026-10-16", lands_on == "2026-10-16-2")
    if on_old:
        assert old.stroke_count == 1


# ── 글 상자·사진·옮긴 획 고치기·버린 편집 알림(#268) ─────────────


async def send_edit(y: YClient, fn) -> None:
    before = y.doc.get_state()
    with y.doc.transaction():
        fn(y.doc)
    await y.ws.send_to(bytes_data=create_update_message(y.doc.get_update(before)))


def new_box(doc: Doc, key: str) -> None:
    doc.get("textboxes", type=Map)[key] = Map({"x": 10, "y": 20, "width": 200, "author": "a", "content": XmlFragment()})


def type_text(doc: Doc, key: str, text: str) -> None:
    frag = doc.get("textboxes", type=Map)[key]["content"]
    if len(frag.children) == 0:
        frag.children.append(XmlElement("paragraph"))
    para = frag.children[0]
    if len(para.children) == 0:
        para.children.append(XmlText())
    t = para.children[0]
    t.insert(len(t), text)


async def next_rolled_and_lost(y: YClient) -> tuple[bytes, int]:
    """교체 알림까지 읽는다. 그 앞에 온 「버린 편집」 알림의 수(없으면 0)도 돌려준다."""
    lost = 0
    while True:
        msg = await y.ws.receive_output(timeout=3)
        assert msg["type"] == "websocket.send", msg
        data = msg["bytes"]
        if data[0] == MESSAGE_EDITS_LOST:
            lost += json.loads(data[2:])["count"]
        elif data[0] == MESSAGE_PAGE_ROLLED:
            return data, lost
        else:
            await y._handle(msg)


@sync_to_async
def doc_on(note_id: str, key: str) -> Doc:
    date, seq = pages.parse_key(key)
    return pages.load_doc(Page.objects.get(note_id=note_id, date=date, seq=seq).id)


@sync_to_async
def add_photo_row(note_id: str, key: str, photo_id: str) -> None:
    date, seq = pages.parse_key(key)
    page = Page.objects.get(note_id=note_id, date=date, seq=seq)
    Photo.objects.create(id=photo_id, note_id=note_id, page=page, mime="image/webp", size=10)
    Photo.objects.filter(pk=photo_id).update(created_at=DUE - dt.timedelta(seconds=1))


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_text_box_text_and_photo_made_after_due_move_to_the_new_page(moment):
    """(1) 닫힌 뒤 옛 장에 만든 글 상자·친 글자·붙인 사진은 새 장의 같은 자리에 있다. 사진 원본도 새 장에 매인다."""
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    (room,) = hub.hub().rooms.values()
    # 봉인 직전에 만든 빈 글 상자(저장됨) — 봉인 때 빈 상자로 지워진다
    await send_edit(a, lambda d: new_box(d, "early-box"))
    await until(lambda: room.saved == 1)
    photo_id = "f" * 32
    await add_photo_row(note_id, "2026-10-15", photo_id)  # 봉인 직전에 올렸다

    moment["now"] = DUE + dt.timedelta(milliseconds=100)

    def late(d: Doc) -> None:
        type_text(d, "early-box", "자정 넘어")
        new_box(d, "late-box")
        type_text(d, "late-box", "새 상자")
        d.get("photos", type=Map)["late-photo"] = Map({"src": photo_id, "createdAt": 1, "x": 0, "y": 0, "author": "a"})

    await send_edit(a, late)

    rolled, lost = await next_rolled_and_lost(a)
    assert b'"key":"2026-10-16"' in rolled
    assert lost == 0
    new = await doc_on(note_id, "2026-10-16")
    boxes = new.get("textboxes", type=Map)
    assert str(boxes["early-box"]["content"]) == "<paragraph>자정 넘어</paragraph>"
    assert str(boxes["late-box"]["content"]) == "<paragraph>새 상자</paragraph>"
    assert boxes["late-box"]["x"] == 10
    assert new.get("photos", type=Map)["late-photo"]["src"] == photo_id
    old = await doc_on(note_id, "2026-10-15")
    assert "late-box" not in old.get("textboxes", type=Map)
    assert "late-photo" not in old.get("photos", type=Map)
    new_page = await page_of(note_id, "2026-10-16")
    assert await sync_to_async(lambda: Photo.objects.get(pk=photo_id).page_id)() == new_page.id


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_cutting_a_carried_stroke_before_the_switch_leaves_only_the_pieces(moment, settings):
    """(2) 닫힌 뒤 그어 새 장으로 옮긴 획 S를 화면이 바뀌기 전에 지우개로 자르거나 옮기면 새 장에도 그대로 된다:
    원래 S와 조각이 겹쳐 남지 않는다."""
    settings.ROLL_CLOSE_AFTER = 30
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    moment["now"] = DUE + dt.timedelta(milliseconds=100)
    s = "latestroke000000"
    await draw(a, s)
    await next_rolled(a)

    await send_edit(a, lambda d: d.get("strokes", type=Map)[s].update({"points": [5.0, 5.0, 0.5]}))
    await until_on_new_page(note_id, lambda strokes: strokes.get(s, {}).get("points") == [5.0, 5.0, 0.5])

    def cut(d: Doc) -> None:
        strokes = d.get("strokes", type=Map)
        strokes[s + "aaaa"] = Map(pen("a"))
        strokes[s + "bbbb"] = Map(pen("a"))
        del strokes[s]

    await send_edit(a, cut)
    await until_on_new_page(note_id, lambda strokes: set(strokes) == {s + "aaaa", s + "bbbb"})
    assert set(await strokes_on(note_id, "2026-10-15")) == set()
    await a.close()


async def until_on_new_page(note_id: str, condition) -> None:
    """새 장에 저장된 획이 조건에 맞을 때까지 읽는다(늦은 편집은 받은 차례대로 DB 왕복 한 번에 저장된다)."""

    async def saved() -> bool:
        return bool(condition(await strokes_on(note_id, "2026-10-16")))

    await until(saved)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_erasing_or_typing_into_old_page_things_after_due_is_told_not_silently_lost(moment):
    """닫힌 뒤 앞 장에 남은 획을 자르고 앞 장 글 상자에 글자를 치면 둘 다 옮길 수 없다: 앞 장은 봉인 때 그대로, 새 장에도 없고,
    「n개는 저장되지 않았어요」를 교체 알림보다 먼저 알린다."""
    note_id, owner, _ = await setup_note()
    a = await join(owner, note_id, "2026-10-15")
    (room,) = hub.hub().rooms.values()
    old_id = "oldstroke0000000"
    await draw(a, old_id)
    await send_edit(a, lambda d: (new_box(d, "old-box"), type_text(d, "old-box", "앞 장")))
    await until(lambda: room.saved == 2)
    moment["now"] = DUE + dt.timedelta(milliseconds=100)

    def late(d: Doc) -> None:
        strokes = d.get("strokes", type=Map)
        strokes[old_id + "aaaa"] = Map(pen("a"))
        strokes[old_id + "bbbb"] = Map(pen("a"))
        del strokes[old_id]
        type_text(d, "old-box", " 끝")
        strokes["freshstroke00000"] = Map(pen("a"))

    await send_edit(a, late)

    rolled, lost = await next_rolled_and_lost(a)
    assert b'"key":"2026-10-16"' in rolled
    assert lost == 2
    assert set(await strokes_on(note_id, "2026-10-16")) == {"freshstroke00000"}
    old = await doc_on(note_id, "2026-10-15")
    assert set(old.get("strokes", type=Map).keys()) == {old_id}
    assert str(old.get("textboxes", type=Map)["old-box"]["content"]) == "<paragraph>앞 장</paragraph>"


# ── 사진 원본(봉인 직전 올린 것) ──────────────────────────────────


def test_photo_uploaded_just_before_due_and_placed_late_stays_on_the_sealed_page(note, at):
    """봉인 직전 올린 사진을 문서에 붙인 편집이 방에 있던 사이 봉인이 돌아도(닫히기 전에 받음) 원본을 지우지 않고 앞 장에 남는다."""
    page = pages.get_or_create_page(note, YESTERDAY)
    Photo.objects.create(id="e" * 32, note=note, page=page, mime="image/webp", size=10)
    Photo.objects.filter(pk="e" * 32).update(created_at=DUE - dt.timedelta(seconds=1))
    at(DUE + dt.timedelta(seconds=1))
    sealing.seal_page(page.id)
    assert Photo.objects.filter(pk="e" * 32).exists()

    doc = Doc()
    doc.get("photos", type=Map)["p"] = Map({"src": "e" * 32, "createdAt": 1, "author": "졸린 수달", "x": 0})
    pages.append_update(page.id, doc.get_update(), JUST_BEFORE)

    page.refresh_from_db()
    state = Doc()
    state.apply_update(bytes(page.state))
    assert list(state.get("photos", type=Map).keys()) == ["p"]
    assert not page.is_empty


# ── 봉인 장 스냅샷 캐시 ──────────────────────────────────────────


def test_sealed_snapshot_is_revalidated_while_late_edits_can_still_merge(note, at):
    """(4) 봉인 직후 받은 스냅샷은 immutable로 굳히지 않는다. 늦게 합친 뒤 다시 받으면(ETag로 확인) 새 내용이 온다."""
    client = login_as(1)
    page = pages.get_or_create_page(note, YESTERDAY)
    PageUpdate.objects.create(page=page, update=stroke_update({"s1": pen("졸린 수달")}))
    at(DUE + dt.timedelta(seconds=1))
    sealing.seal_page(page.id)
    url = f"/api/notes/{note.id}/pages/{YESTERDAY.isoformat()}"

    first = client.get(url)
    assert first.status_code == 200
    assert "immutable" not in first["Cache-Control"]
    assert "no-cache" in first["Cache-Control"]
    etag = first["ETag"]
    assert client.get(url, HTTP_IF_NONE_MATCH=etag).status_code == 304

    pages.append_update(page.id, stroke_update({"s2": pen("푸른 펭귄")}), JUST_BEFORE)

    again = client.get(url, HTTP_IF_NONE_MATCH=etag)
    assert again.status_code == 200
    assert set(strokes_of(again.content)) == {"s1", "s2"}
    assert again["ETag"] != etag

    at(DUE + dt.timedelta(hours=1))
    settled = client.get(url)
    assert "immutable" in settled["Cache-Control"]
