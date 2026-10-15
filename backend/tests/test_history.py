import datetime as dt

import pytest
from pycrdt import Doc, Map

from daypage import clock
from daypage.models import Note, PageUpdate
from daypage.pages import get_or_create_page
from daypage.sealing import seal_due_pages
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


def write(note_id: str, date: dt.date, strokes: dict[str, str]) -> None:
    page = get_or_create_page(Note.objects.get(pk=note_id), date)
    doc = Doc()
    m = doc.get("strokes", type=Map)
    for sid, author in strokes.items():
        m[sid] = Map({"tool": "pen", "author": author})
    PageUpdate.objects.create(page=page, update=doc.get_update())


@pytest.fixture
def history(monkeypatch):
    """10/13(2명·3획), 10/14(빈 장), 10/15(1명·1획)가 봉인되고 오늘은 10/16."""
    owner = login_as(1)
    note_id = create_note(owner)
    write(note_id, dt.date(2026, 10, 13), {"a": "졸린 수달", "b": "푸른 펭귄", "c": "졸린 수달"})
    get_or_create_page(Note.objects.get(pk=note_id), dt.date(2026, 10, 14))
    write(note_id, dt.date(2026, 10, 15), {"d": "졸린 수달"})
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 16, 9, 0))
    seal_due_pages()
    write(note_id, dt.date(2026, 10, 16), {"today": "졸린 수달"})
    return note_id, owner


def test_sealed_pages_newest_first_without_empty_ones(history):
    note_id, owner = history
    res = owner.get(f"/api/notes/{note_id}/pages")
    assert res.status_code == 200
    assert res.json() == [
        {"date": "2026-10-15", "participantCount": 1, "strokeCount": 1},
        {"date": "2026-10-13", "participantCount": 2, "strokeCount": 3},
    ]


def test_sealed_page_snapshot_is_binary_yjs(history):
    note_id, owner = history
    res = owner.get(f"/api/notes/{note_id}/pages/2026-10-13")
    assert res.status_code == 200
    assert res["Content-Type"] == "application/octet-stream"
    doc = Doc()
    doc.apply_update(res.content)
    assert set(doc.get("strokes", type=Map).keys()) == {"a", "b", "c"}


def test_todays_unsealed_page_is_not_in_history(history):
    note_id, owner = history
    assert owner.get(f"/api/notes/{note_id}/pages/2026-10-16").status_code == 404


def test_empty_sealed_page_is_not_served(history):
    note_id, owner = history
    assert owner.get(f"/api/notes/{note_id}/pages/2026-10-14").status_code == 404


def test_bad_date_is_404(history):
    note_id, owner = history
    assert owner.get(f"/api/notes/{note_id}/pages/not-a-date").status_code == 404


def test_non_member_cannot_read_history(history):
    note_id, _ = history
    stranger = login_as(99)
    assert stranger.get(f"/api/notes/{note_id}/pages").status_code == 403
    assert stranger.get(f"/api/notes/{note_id}/pages/2026-10-13").status_code == 403
