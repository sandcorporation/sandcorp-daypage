"""장의 기간·키·열린 장 판정(#41)."""

import datetime as dt

import pytest

from daypage import clock, pages
from daypage.models import Note, Page
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


@pytest.fixture
def note(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 21, 10, 0))
    return Note.objects.get(pk=create_note(login_as(1)))


def test_page_key_and_parse_roundtrip():
    assert pages.page_key(dt.date(2026, 10, 21)) == "2026-10-21"
    assert pages.page_key(dt.date(2026, 10, 21), 2) == "2026-10-21-2"
    assert pages.parse_key("2026-10-21") == (dt.date(2026, 10, 21), 1)
    assert pages.parse_key("2026-10-21-2") == (dt.date(2026, 10, 21), 2)
    for bad in ["not-a-date", "2026-10-21-", "2026-10-21-1", "2026-10-21-x", "2026-10-21x"]:
        with pytest.raises(ValueError):
            pages.parse_key(bad)


def test_open_page_starts_at_the_boundary_before_now(note):
    page = pages.open_page(note, kst(2026, 10, 21, 10, 0))
    assert (page.date, page.seq) == (dt.date(2026, 10, 21), 1)
    assert page.opened_at == kst(2026, 10, 21, 0, 0)
    assert page.due_at == kst(2026, 10, 22, 0, 0)
    # 기간 안이면 같은 장
    assert pages.open_page(note, kst(2026, 10, 21, 23, 59)).id == page.id


def test_note_sealing_at_four_has_days_from_four_to_four(note):
    Note.objects.filter(pk=note.pk).update(seal_hour=4)
    note.refresh_from_db()
    page = pages.open_page(note, kst(2026, 10, 22, 1, 0))
    assert page.date == dt.date(2026, 10, 21)
    assert page.opened_at == kst(2026, 10, 21, 4, 0)
    assert page.due_at == kst(2026, 10, 22, 4, 0)
    assert pages.open_page(note, kst(2026, 10, 22, 4, 0)).date == dt.date(2026, 10, 22)


def test_open_page_seals_an_overdue_page_first_and_opens_the_next(note):
    first = pages.open_page(note, kst(2026, 10, 21, 10, 0))
    nxt = pages.open_page(note, kst(2026, 10, 22, 0, 0, 1))
    first.refresh_from_db()
    assert first.sealed_at is not None
    assert (nxt.date, nxt.seq) == (dt.date(2026, 10, 22), 1)
    assert nxt.sealed_at is None


def test_second_page_on_the_same_date_gets_seq_2(note):
    first = pages.open_page(note, kst(2026, 10, 21, 10, 0))
    # 주인이 봉인 시각을 11시로 바꿨다고 치고 due를 당긴다(#43이 하는 일)
    Page.objects.filter(pk=first.pk).update(due_at=kst(2026, 10, 21, 11, 0))
    Note.objects.filter(pk=note.pk).update(seal_hour=11)
    note.refresh_from_db()
    second = pages.open_page(note, kst(2026, 10, 21, 11, 0, 5))
    assert (second.date, second.seq) == (dt.date(2026, 10, 21), 2)
    assert second.opened_at == kst(2026, 10, 21, 11, 0)
    assert second.due_at == kst(2026, 10, 22, 11, 0)
    assert pages.page_key(second.date, second.seq) == "2026-10-21-2"


def test_current_key_does_not_create_a_page(note):
    assert pages.current_key(note, kst(2026, 10, 21, 10, 0)) == "2026-10-21"
    assert Page.objects.filter(note=note).count() == 0
    page = pages.open_page(note, kst(2026, 10, 21, 10, 0))
    assert pages.current_key(note, kst(2026, 10, 21, 10, 0)) == pages.page_key(page.date, page.seq)
    # 기간이 끝났으면 다음 장의 키(아직 만들지 않는다)
    assert pages.current_key(note, kst(2026, 10, 22, 0, 0)) == "2026-10-22"
    assert Page.objects.filter(note=note).count() == 1


def test_pages_created_without_period_get_it_from_the_date_and_seal_hour(note):
    Note.objects.filter(pk=note.pk).update(seal_hour=6)
    note.refresh_from_db()
    page = Page.objects.create(note=note, date=dt.date(2026, 10, 20))
    assert page.opened_at == kst(2026, 10, 20, 6, 0)
    assert page.due_at == kst(2026, 10, 21, 6, 0)
