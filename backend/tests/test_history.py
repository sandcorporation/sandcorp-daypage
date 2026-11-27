import datetime as dt

import pytest
from pycrdt import Doc, Map

from daypage import clock
from daypage.models import Note, PageUpdate
from daypage.pages import get_or_create_page, open_page
from daypage.sealing import seal_due_pages
from tests.helpers import create_note, login_as
from tests.test_admin import staff

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

DEFAULT_PAPER = {"pattern": "lined", "margin": True, "color": "white"}


def test_sealed_pages_newest_first_without_empty_ones(history):
    note_id, owner = history
    res = owner.get(f"/api/notes/{note_id}/pages")
    assert res.status_code == 200
    assert res.json() == [
        {
            "key": "2026-10-15",
            "date": "2026-10-15",
            "seq": 1,
            "openedAt": "2026-10-15T00:00:00+09:00",
            "closedAt": "2026-10-16T00:00:00+09:00",
            "participantCount": 1,
            "strokeCount": 1,
            "paper": DEFAULT_PAPER,
        },
        {
            "key": "2026-10-13",
            "date": "2026-10-13",
            "seq": 1,
            "openedAt": "2026-10-13T00:00:00+09:00",
            "closedAt": "2026-10-14T00:00:00+09:00",
            "participantCount": 2,
            "strokeCount": 3,
            "paper": DEFAULT_PAPER,
        },
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


def test_member_reads_todays_open_page_as_binary_yjs(history):
    note_id, owner = history
    res = owner.get(f"/api/notes/{note_id}/today")
    assert res.status_code == 200
    assert res["Content-Type"] == "application/octet-stream"
    assert res["Cache-Control"] == "no-store"
    doc = Doc()
    doc.apply_update(res.content)
    assert set(doc.get("strokes", type=Map).keys()) == {"today"}


def test_non_member_cannot_read_todays_page(history):
    note_id, _ = history
    assert login_as(99).get(f"/api/notes/{note_id}/today").status_code == 403


def ranges(owner, note_id: str) -> list[tuple[str, str, str]]:
    return [(p["key"], p["openedAt"][5:16], p["closedAt"][5:16]) for p in owner.get(f"/api/notes/{note_id}/pages").json()]


def test_page_sealed_a_few_seconds_late_closes_at_its_boundary(history, monkeypatch):
    """제때 봉인은 작업이 늦게 돌아도(작업이 몇 시간 밀려도) 꼬박 하루로 남는다."""
    note_id, owner = history
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 17, 3, 0, 7))
    seal_due_pages()
    assert ranges(owner, note_id)[0] == ("2026-10-16", "10-16T00:00", "10-17T00:00")


@pytest.mark.parametrize(
    "sealed_at, closed",
    [
        (kst(2026, 10, 16, 11, 0, 9), "10-16T11:00"),  # 앞당긴 시각에 제때 봉인(작업이 몇 초 늦음)
        (kst(2026, 10, 16, 13, 0, 7), "10-16T13:00"),  # 작업이 두 시간 밀림: 구별할 수 없어 봉인한 때로 적는다
    ],
)
def test_rescheduled_page_closing_time(history, monkeypatch, sealed_at, closed):
    note_id, owner = history
    assert owner.patch(f"/api/notes/{note_id}", {"sealHour": 11}, content_type="application/json").status_code == 200
    monkeypatch.setattr(clock, "now", lambda: sealed_at)
    seal_due_pages()
    assert ranges(owner, note_id)[0] == ("2026-10-16", "10-16T00:00", closed)


@pytest.mark.parametrize("first_page_is_empty", [False, True])
def test_page_sealed_right_away_shows_when_it_was_really_open(history, monkeypatch, first_page_is_empty):
    """14시에 8시로 바꾸면 그 장은 14시까지, 다음 장은 8시 경계가 아니라 14시부터다(앞 장이 비어 기록에 없어도)."""
    note_id, owner = history
    if first_page_is_empty:
        PageUpdate.objects.filter(page__note_id=note_id, page__date=dt.date(2026, 10, 16)).delete()
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 16, 14, 0, 30))
    assert owner.patch(f"/api/notes/{note_id}", {"sealHour": 8}, content_type="application/json").status_code == 200
    page = open_page(Note.objects.get(pk=note_id))
    doc = Doc()
    doc.get("strokes", type=Map)["next"] = Map({"tool": "pen", "author": "졸린 수달"})
    PageUpdate.objects.create(page=page, update=doc.get_update())
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 17, 8, 0, 5))
    seal_due_pages()

    got = ranges(owner, note_id)
    assert got[0] == ("2026-10-16-2", "10-16T14:00", "10-17T08:00")
    if not first_page_is_empty:
        assert got[1] == ("2026-10-16", "10-16T00:00", "10-16T14:00")
    detail = staff().get(f"/api/admin/notes/{note_id}").json()
    assert [(p["key"], p["openedAt"][5:16], p["closedAt"][5:16]) for p in detail["pages"]] == got
