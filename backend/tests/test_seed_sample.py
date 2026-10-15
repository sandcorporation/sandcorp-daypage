import datetime as dt

import pytest
from django.core.management import CommandError, call_command
from pycrdt import Map

from daypage import clock
from daypage.models import Note, Page
from daypage.pages import build_doc, load_updates
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: dt.datetime(2026, 10, 15, 21, 0, tzinfo=clock.KST))


def today_doc(note_id: str):
    page = Page.objects.get(note_id=note_id, date=dt.date(2026, 10, 15))
    return build_doc(load_updates(page.id))


def test_fills_todays_empty_page_with_text_boxes_and_doodles():
    note_id = create_note(login_as(1), name="샘플용 페이지")
    call_command("seed_sample", note_id)
    doc = today_doc(note_id)
    boxes = doc.get("textboxes", type=Map)
    strokes = doc.get("strokes", type=Map)
    assert len(boxes) >= 10
    assert len(strokes) >= 10
    for m in boxes.values():
        assert 0 <= m.get("y") <= 2400 - 32 and m.get("y") % 32 == 0
        assert m.get("x") + m.get("width") <= 1600
        assert len(list(m.get("content").children)) >= 1
    for m in strokes.values():
        points = m.get("points")
        assert isinstance(points, list) and len(points) % 3 == 0
        assert all(0 <= v <= 2400 for v in points)


def test_does_not_overwrite_a_page_that_already_has_content():
    note_id = create_note(login_as(1))
    call_command("seed_sample", note_id)
    count = len(today_doc(note_id).get("textboxes", type=Map))
    with pytest.raises(CommandError):
        call_command("seed_sample", note_id)
    assert len(today_doc(note_id).get("textboxes", type=Map)) == count


def test_force_replaces_existing_content():
    note_id = create_note(login_as(1))
    call_command("seed_sample", note_id)
    first = set(today_doc(note_id).get("textboxes", type=Map).keys())
    call_command("seed_sample", note_id, "--force")
    second = set(today_doc(note_id).get("textboxes", type=Map).keys())
    assert first.isdisjoint(second)
    assert len(second) == len(first)


def test_unknown_note_is_an_error():
    with pytest.raises(CommandError):
        call_command("seed_sample", "nope")
    assert not Note.objects.filter(pk="nope").exists()


def box_rects(doc):
    return [(m.get("x"), m.get("y"), m.get("width")) for m in doc.get("textboxes", type=Map).values()]


def test_dense_style_fills_the_whole_page_without_overlap():
    note_id = create_note(login_as(1))
    call_command("seed_sample", note_id, "--style", "dense")
    doc = today_doc(note_id)
    boxes = doc.get("textboxes", type=Map)
    assert len(boxes) >= 250
    assert len(doc.get("strokes", type=Map)) >= 30
    ys = [m.get("y") for m in boxes.values()]
    assert min(ys) <= 64 and max(ys) >= 2400 - 96  # 위부터 아래까지
    # 같은 칸을 차지하는 상자끼리 가로로 겹치지 않는다(여러 줄 상자는 차지하는 칸 모두)
    occupied: dict[int, list[tuple[float, float]]] = {}
    for m in boxes.values():
        lines = len(list(m.get("content").children))
        for row in range(int(m.get("y")) // 32, int(m.get("y")) // 32 + lines):
            for a, b in occupied.get(row, []):
                assert m.get("x") >= b or m.get("x") + m.get("width") <= a
            occupied.setdefault(row, []).append((m.get("x"), m.get("x") + m.get("width")))


def test_new_option_creates_a_note_for_the_same_owner():
    owner = login_as(1)
    note_id = create_note(owner, name="샘플용 페이지", memberLimit=2)
    call_command("seed_sample", note_id, "--style", "sparse", "--new", "샘플용 페이지 (간단)")
    new = Note.objects.get(name="샘플용 페이지 (간단)")
    template = Note.objects.get(pk=note_id)
    assert new.owner_id == template.owner_id and new.member_limit == 2
    assert new.members.filter(user_id=template.owner_id).exists()
    assert len(today_doc(new.id).get("textboxes", type=Map)) >= 10
    assert not Page.objects.filter(note_id=note_id).exists()  # 템플릿 노트는 건드리지 않는다


def test_dense_style_uses_four_columns_each_filled_top_to_bottom():
    note_id = create_note(login_as(1))
    call_command("seed_sample", note_id, "--style", "dense")
    boxes = list(today_doc(note_id).get("textboxes", type=Map).values())
    starts = [80, 457, 834, 1211]
    for m in boxes:
        assert any(s <= m.get("x") <= s + 24 for s in starts), m.get("x")
        assert m.get("x") + m.get("width") <= 1600
    for s in starts:
        col = [m for m in boxes if s <= m.get("x") <= s + 24]
        assert len(col) >= 40
        assert min(m.get("y") for m in col) <= 64
        assert max(m.get("y") for m in col) >= 2400 - 32 * 6
