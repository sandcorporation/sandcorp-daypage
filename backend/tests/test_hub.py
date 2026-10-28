"""프로세스 안의 장 방(hub). 두 프로세스는 같은 채널 레이어를 쓰는 Hub 두 개로 흉내 낸다."""

import datetime as dt

import pytest
from asgiref.sync import sync_to_async
from channels.exceptions import ChannelFull
from pycrdt import Doc, Map, YMessageType, read_message

from daypage import awareness, clock, hub, pages
from daypage.models import Note
from tests.helpers import create_note, login_as
from tests.waiting import until

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.asyncio]

TODAY = dt.datetime(2026, 10, 15, 15, 0, tzinfo=clock.KST)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


class FakeMember:
    def __init__(self):
        self.got: list[tuple[bytes, bool]] = []

    def push(self, data: bytes, volatile: bool = False) -> None:
        self.got.append((data, volatile))

    async def page_sealed(self) -> None: ...

    async def page_gone(self) -> None: ...

    def awareness(self) -> list[list[awareness.Entry]]:
        return [awareness.decode_message(d) for d, _ in self.got if d[0] == YMessageType.AWARENESS]

    def doc(self) -> Doc:
        doc = Doc()
        for d, _ in self.got:
            if d[0] == YMessageType.SYNC:
                doc.apply_update(read_message(d[2:]))
        return doc


@sync_to_async
def make_page() -> int:
    note_id = create_note(login_as(1))
    return pages.get_or_create_page(Note.objects.get(pk=note_id), TODAY.date()).id


def stroke_update(doc: Doc, stroke_id: str) -> bytes:
    before = doc.get_state()
    doc.get("strokes", type=Map)[stroke_id] = Map({"tool": "pen", "points": [0.0, 0.0, 0.5]})
    return doc.get_update(before)


def load(page_id: int):
    return lambda: hub.db(pages.load_updates)(page_id)


async def test_edit_in_one_process_reaches_people_in_the_other():
    page_id = await make_page()
    one, two = hub.Hub(), hub.Hub()
    a, b = FakeMember(), FakeMember()
    room_one = await one.join(page_id, a, load(page_id))
    room_two = await two.join(page_id, b, load(page_id))
    await until(lambda: room_one.peers and room_two.peers)  # 서로를 알아야 편집이 건너간다

    await room_one.local_update(a, stroke_update(Doc(), "s1"), TODAY)
    await until(lambda: "s1" in b.doc().get("strokes", type=Map).keys())

    assert set(b.doc().get("strokes", type=Map).keys()) == {"s1"}
    assert set(room_two.ydoc.get("strokes", type=Map).keys()) == {"s1"}
    await one.leave(room_one, a)
    await two.leave(room_two, b)


async def test_process_opening_later_gets_unsaved_edits_from_the_other():
    page_id = await make_page()
    one, two = hub.Hub(), hub.Hub()
    a, b = FakeMember(), FakeMember()
    room_one = await one.join(page_id, a, load(page_id))
    # 아직 저장 전(모으는 중)인 편집
    await room_one.local_update(a, stroke_update(Doc(), "unsaved"), TODAY)

    room_two = await two.join(page_id, b, load(page_id))
    await until(lambda: "unsaved" in room_two.ydoc.get("strokes", type=Map).keys())

    assert "unsaved" in room_two.ydoc.get("strokes", type=Map).keys()
    await one.leave(room_one, a)
    await two.leave(room_two, b)


async def test_cursors_are_sent_together_and_not_echoed_to_a_lone_sender():
    page_id = await make_page()
    h = hub.Hub()
    a, b = FakeMember(), FakeMember()
    room = await h.join(page_id, a, load(page_id))
    await h.join(page_id, b, load(page_id))

    # 첫 커서는 바로, 그 뒤 잠깐 사이에 온 것들은 모아서 한 번에 간다
    await room.local_awareness(a, [(1, 1, {"cursor": {"x": 1, "y": 1}})])
    await room.local_awareness(a, [(1, 2, {"cursor": {"x": 2, "y": 2}})])
    await room.local_awareness(b, [(2, 1, {"cursor": {"x": 9, "y": 9}})])
    await until(lambda: len(b.awareness()) == 2 and len(a.awareness()) == 1)  # 모아 보낸 묶음이 도착할 때까지

    assert b.awareness() == [
        [(1, 1, {"cursor": {"x": 1, "y": 1}})],
        [(1, 2, {"cursor": {"x": 2, "y": 2}}), (2, 1, {"cursor": {"x": 9, "y": 9}})],
    ]
    # a는 자기 커서만 든 첫 메시지는 받지 않는다
    assert a.awareness() == [[(1, 2, {"cursor": {"x": 2, "y": 2}}), (2, 1, {"cursor": {"x": 9, "y": 9}})]]
    await h.leave(room, a)
    await h.leave(room, b)


async def test_newcomer_in_another_process_sees_existing_cursors():
    page_id = await make_page()
    one, two = hub.Hub(), hub.Hub()
    a, b = FakeMember(), FakeMember()
    room_one = await one.join(page_id, a, load(page_id))
    await room_one.local_awareness(a, [(1, 1, {"cursor": {"x": 5, "y": 5}})])

    room_two = await two.join(page_id, b, load(page_id))
    await until(lambda: room_two.presence_message() is not None)

    assert room_two.presence_message() is not None
    assert awareness.decode_message(room_two.presence_message()) == [(1, 1, {"cursor": {"x": 5, "y": 5}})]
    await one.leave(room_one, a)
    await two.leave(room_two, b)


async def test_cursor_to_a_full_peer_is_dropped_not_fatal():
    page_id = await make_page()
    h = hub.Hub()
    a = FakeMember()
    room = await h.join(page_id, a, load(page_id))
    room.peers.add("full-peer")

    class FullLayer:
        async def send(self, *args, **kwargs):
            raise ChannelFull()

    real = h.layer
    h.layer = FullLayer()
    await room.local_awareness(a, [(1, 1, {"cursor": {"x": 1, "y": 1}})])
    h.layer = real
    room.peers.clear()
    await h.leave(room, a)


async def test_last_person_leaving_saves_pending_edits():
    page_id = await make_page()
    h = hub.Hub()
    a = FakeMember()
    room = await h.join(page_id, a, load(page_id))
    await room.local_update(a, stroke_update(Doc(), "kept"), TODAY)
    assert await h.leave(room, a) is True

    saved = pages.build_doc(await hub.db(pages.load_updates)(page_id))
    assert "kept" in saved.get("strokes", type=Map).keys()
