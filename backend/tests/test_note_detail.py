import datetime as dt

import pytest

from daypage import clock
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def patch_kst(monkeypatch, *args):
    moment = dt.datetime(*args, tzinfo=clock.KST)
    monkeypatch.setattr(clock, "now", lambda: moment)


def test_two_accounts_get_different_nicknames():
    owner = login_as(1)
    note_id = create_note(owner)
    a = owner.get(f"/api/notes/{note_id}").json()["me"]
    b = login_as(2).get(f"/api/notes/{note_id}").json()["me"]
    assert a["nickname"] != b["nickname"]
    assert a["color"].startswith("#") and b["color"].startswith("#")


def test_same_account_keeps_nickname_and_color_in_a_note():
    owner = login_as(1)
    note_id = create_note(owner)
    guest = login_as(2)
    first = guest.get(f"/api/notes/{note_id}").json()["me"]
    again = guest.get(f"/api/notes/{note_id}").json()["me"]
    assert first == again


def test_entering_another_note_assigns_a_separate_membership():
    owner = login_as(1)
    first = create_note(owner)
    second = create_note(owner)
    guest = login_as(2)
    for note_id in (first, second):
        guest.get(f"/api/notes/{note_id}")
    assert {n["id"] for n in guest.get("/api/me").json()["notes"]} == {first, second}


def test_detail_has_kst_today_and_next_midnight(monkeypatch):
    patch_kst(monkeypatch, 2026, 10, 15, 23, 59, 50)
    owner = login_as(1)
    note_id = create_note(owner)
    body = owner.get(f"/api/notes/{note_id}").json()
    assert body["today"] == "2026-10-15"
    assert dt.datetime.fromisoformat(body["nextMidnight"]) == dt.datetime(2026, 10, 16, tzinfo=clock.KST)
    assert body["isOwner"] is True


def test_owner_can_rename_note():
    owner = login_as(1)
    note_id = create_note(owner)
    res = owner.patch(f"/api/notes/{note_id}", {"name": "우리집 공용 노트"}, content_type="application/json")
    assert res.status_code == 200
    assert owner.get(f"/api/notes/{note_id}").json()["name"] == "우리집 공용 노트"


def test_blank_name_falls_back_to_default():
    owner = login_as(1)
    note_id = create_note(owner, name="이름")
    owner.patch(f"/api/notes/{note_id}", {"name": "   "}, content_type="application/json")
    assert owner.get(f"/api/notes/{note_id}").json()["name"] == "이름 없는 노트"


def test_non_owner_cannot_rename():
    owner = login_as(1)
    note_id = create_note(owner, name="원래 이름")
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    res = guest.patch(f"/api/notes/{note_id}", {"name": "바꾼 이름"}, content_type="application/json")
    assert res.status_code == 403
    assert owner.get(f"/api/notes/{note_id}").json()["name"] == "원래 이름"
