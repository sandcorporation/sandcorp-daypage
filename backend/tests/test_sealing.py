import datetime as dt

import pytest
from asgiref.sync import sync_to_async
from pycrdt import Doc, Map

from daypage import clock
from daypage.models import Note, Page, PageUpdate
from daypage.pages import get_or_create_page
from daypage.sealing import seal_due_pages
from tests.helpers import create_note, login_as


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


def doc_update(strokes: dict[str, str] = {}, boxes: dict[str, str] = {}) -> bytes:
    doc = Doc()
    s = doc.get("strokes", type=Map)
    b = doc.get("textboxes", type=Map)
    for sid, author in strokes.items():
        s[sid] = Map({"tool": "pen", "author": author})
    for bid, author in boxes.items():
        b[bid] = Map({"author": author})
    return doc.get_update()


def make_page(note_id: str, date: dt.date, update: bytes | None = None) -> Page:
    page = get_or_create_page(Note.objects.get(pk=note_id), date)
    if update:
        PageUpdate.objects.create(page=page, update=update)
    return page


@pytest.fixture
def note_id(db):
    return create_note(login_as(1))


@pytest.fixture
def at(monkeypatch):
    def set_now(moment: dt.datetime):
        monkeypatch.setattr(clock, "now", lambda: moment)

    return set_now


def test_yesterday_page_is_sealed_with_stats_after_midnight(note_id, at):
    make_page(note_id, dt.date(2026, 10, 15), doc_update({"s1": "졸린 수달", "s2": "푸른 펭귄"}, {"b1": "졸린 수달"}))
    at(kst(2026, 10, 16, 0, 0, 5))
    sealed = seal_due_pages()
    page = Page.objects.get(note_id=note_id, date=dt.date(2026, 10, 15))
    assert [p.id for p in sealed] == [page.id]
    assert page.sealed_at is not None
    assert (page.stroke_count, page.participant_count, page.is_empty) == (2, 2, False)
    assert PageUpdate.objects.filter(page=page).count() == 0
    doc = Doc()
    doc.apply_update(bytes(page.state))
    assert set(doc.get("strokes", type=Map).keys()) == {"s1", "s2"}


def test_todays_page_is_not_sealed(note_id, at):
    make_page(note_id, dt.date(2026, 10, 16), doc_update({"s": "a"}))
    at(kst(2026, 10, 16, 0, 0, 5))
    assert seal_due_pages() == []
    assert Page.objects.get(note_id=note_id).sealed_at is None


def test_sealing_twice_changes_nothing(note_id, at):
    make_page(note_id, dt.date(2026, 10, 15), doc_update({"s": "a"}))
    at(kst(2026, 10, 16, 0, 0, 5))
    seal_due_pages()
    first = Page.objects.get(note_id=note_id)
    at(kst(2026, 10, 16, 1, 0, 0))
    assert seal_due_pages() == []
    again = Page.objects.get(note_id=note_id)
    assert (again.sealed_at, bytes(again.state), again.stroke_count) == (
        first.sealed_at,
        bytes(first.state),
        first.stroke_count,
    )


def test_backlog_of_several_days_is_sealed_in_one_run(note_id, at):
    make_page(note_id, dt.date(2026, 10, 13), doc_update({"a": "x"}))
    make_page(note_id, dt.date(2026, 10, 14), doc_update({"b": "x"}))
    at(kst(2026, 10, 16, 9, 0))
    assert len(seal_due_pages()) == 2
    assert not Page.objects.filter(sealed_at__isnull=True).exists()


def test_page_without_strokes_or_boxes_is_sealed_as_empty(note_id, at):
    make_page(note_id, dt.date(2026, 10, 15))
    at(kst(2026, 10, 16, 0, 0, 5))
    seal_due_pages()
    page = Page.objects.get(note_id=note_id)
    assert (page.is_empty, page.stroke_count, page.participant_count) == (True, 0, 0)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_people_on_yesterdays_page_are_told_to_roll_over(monkeypatch):
    from daypage.consumers import MESSAGE_PAGE_ROLLED
    from daypage.sealing import seal_and_announce
    from tests.ws import expect_close, join

    moment = {"now": kst(2026, 10, 15, 23, 59, 50)}
    monkeypatch.setattr(clock, "now", lambda: moment["now"])
    owner = await sync_to_async(login_as)(1)
    note = await sync_to_async(create_note)(owner)
    y = await join(owner, note, "2026-10-15")

    moment["now"] = kst(2026, 10, 16, 0, 0, 5)
    await sync_to_async(seal_and_announce)()

    msg = await y.ws.receive_output(timeout=3)
    assert msg["bytes"][0] == MESSAGE_PAGE_ROLLED
    assert b'"key":"2026-10-16"' in msg["bytes"]
    assert await expect_close(y.ws) == 4409


def box_update(boxes: dict[str, str]) -> bytes:
    """글 상자(아이디 → 글)를 만든다. 글이 빈 문자열이면 빈 상자."""
    from pycrdt import XmlElement, XmlFragment, XmlText

    doc = Doc()
    b = doc.get("textboxes", type=Map)
    for bid, text in boxes.items():
        fragment = XmlFragment()
        b[bid] = Map({"author": "졸린 수달", "content": fragment})
        paragraph = XmlElement("paragraph")
        fragment.children.append(paragraph)
        t = XmlText()
        paragraph.children.append(t)
        if text:
            t.insert(0, text)
    return doc.get_update()


def test_empty_text_boxes_are_dropped_when_sealed(note_id, at):
    at(kst(2026, 10, 15, 22, 0))
    page = make_page(note_id, dt.date(2026, 10, 15), box_update({"empty": "", "full": "안녕"}))
    at(kst(2026, 10, 16, 0, 1))
    seal_due_pages()
    page.refresh_from_db()
    doc = Doc()
    doc.apply_update(bytes(page.state))
    assert list(doc.get("textboxes", type=Map).keys()) == ["full"]
    assert page.is_empty is False


def test_page_with_only_empty_text_boxes_is_sealed_as_empty(note_id, at):
    at(kst(2026, 10, 15, 22, 0))
    page = make_page(note_id, dt.date(2026, 10, 15), box_update({"a": "", "b": ""}))
    at(kst(2026, 10, 16, 0, 1))
    seal_due_pages()
    page.refresh_from_db()
    assert page.is_empty is True


def point_strokes(count: int, per_stroke: int) -> dict[str, list[float]]:
    """옛 형식(points 숫자 배열) 획의 점. 프론트처럼 좌표 0.1, 필압 0.01 단위로 반올림돼 있다."""
    import random

    rng = random.Random(54)
    strokes = {}
    for s in range(count):
        x, y, points = rng.uniform(0, 1600), rng.uniform(0, 2400), []
        for _ in range(per_stroke):
            x += rng.uniform(-3, 3)
            y += rng.uniform(-3, 3)
            points += [round(x, 1), round(y, 1), round(rng.uniform(0.1, 1), 2)]
        strokes[f"s{s}"] = points
    return strokes


def points_update(strokes: dict[str, list[float]], packed: dict[str, bytes] = {}) -> bytes:
    doc = Doc()
    s = doc.get("strokes", type=Map)
    for sid, points in strokes.items():
        s[sid] = Map({"tool": "pen", "color": "#222", "width": 3.0, "points": points, "author": "졸린 수달"})
    for sid, pts in packed.items():
        s[sid] = Map({"tool": "pen", "color": "#222", "width": 3.0, "pts": pts, "author": "푸른 펭귄"})
    return doc.get_update()


def test_stroke_points_are_packed_into_binary_when_sealed(note_id, at):
    from daypage.points import decode_points, encode_points

    old = point_strokes(40, 300)
    already = encode_points([10, 20, 0.5, 11, 21, 0.6])
    at(kst(2026, 10, 15, 22, 0))
    page = make_page(note_id, dt.date(2026, 10, 15), points_update(old, {"new": already}))
    PageUpdate.objects.create(page=page, update=box_update({"full": "안녕"}))
    before = len(points_update(old, {"new": already})) + len(box_update({"full": "안녕"}))
    at(kst(2026, 10, 16, 0, 1))
    seal_due_pages()
    page.refresh_from_db()

    after = len(bytes(page.state))
    # 점 1만 2천 개: 숫자 배열이면 점마다 30바이트쯤, 바이너리면 3~4바이트
    assert after < before * 0.25, (before, after)
    doc = Doc()
    doc.apply_update(bytes(page.state))
    strokes = doc.get("strokes", type=Map)
    for sid, points in old.items():
        stroke = strokes[sid]
        assert "points" not in stroke
        assert decode_points(bytes(stroke["pts"])) == pytest.approx(points, abs=1e-9)
        assert (stroke["tool"], stroke["color"], stroke["width"], stroke["author"]) == ("pen", "#222", 3.0, "졸린 수달")
    assert bytes(strokes["new"]["pts"]) == already
    assert str(doc.get("textboxes", type=Map)["full"]["content"]).count("안녕") == 1
    assert (page.stroke_count, page.participant_count) == (41, 2)
