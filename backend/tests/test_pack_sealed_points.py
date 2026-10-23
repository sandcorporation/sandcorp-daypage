"""이미 봉인된 장의 옛 점(points)을 바이너리(pts)로 다시 쓰는 관리 명령."""

import datetime as dt
from io import StringIO

import pytest
from django.core.management import call_command
from pycrdt import Doc, Map

from daypage import clock
from daypage.models import Page
from daypage.points import decode_points
from tests.helpers import create_note, login_as
from tests.test_sealing import make_page, point_strokes, points_update


def run(*args: str) -> str:
    out = StringIO()
    call_command("pack_sealed_points", *args, stdout=out)
    return out.getvalue()


def sealed_page(note_id: str, date: dt.date, update: bytes) -> Page:
    page = make_page(note_id, date)
    page.state = update
    page.sealed_at = clock.now()
    page.save(update_fields=["state", "sealed_at"])
    return page


def strokes_of(page: Page) -> Map:
    page.refresh_from_db()
    doc = Doc()
    doc.apply_update(bytes(page.state))
    return doc.get("strokes", type=Map)


@pytest.fixture
def note_id(db):
    return create_note(login_as(1))


def test_dry_run_reports_sizes_and_writes_nothing(note_id):
    old = point_strokes(10, 200)
    page = sealed_page(note_id, dt.date(2026, 10, 1), points_update(old))
    before = bytes(page.state)

    out = run()

    page.refresh_from_db()
    assert bytes(page.state) == before
    assert f"{len(before)} → " in out
    assert "드라이런" in out


def test_write_packs_sealed_pages_once_and_leaves_open_pages(note_id):
    old = point_strokes(10, 200)
    sealed = sealed_page(note_id, dt.date(2026, 10, 1), points_update(old))
    size = len(bytes(sealed.state))
    open_page = make_page(note_id, dt.date(2026, 10, 2))
    open_page.state = points_update(old)
    open_page.save(update_fields=["state"])

    run("--write")

    strokes = strokes_of(sealed)
    assert len(bytes(sealed.state)) < size * 0.25
    for sid, points in old.items():
        assert "points" not in strokes[sid]
        assert decode_points(bytes(strokes[sid]["pts"])) == pytest.approx(points, abs=1e-9)
    assert "points" in strokes_of(open_page)["s0"]

    # 두 번째는 바꿀 것이 없다
    packed = bytes(sealed.state)
    out = run("--write")
    sealed.refresh_from_db()
    assert bytes(sealed.state) == packed
    assert "바꿀 페이지 0개" in out
