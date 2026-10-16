"""노트 색: 참여자가 노트에 더하는 사용자 정의 잉크. 노트에 저장되어 날짜가 바뀌어도 남는다."""

import datetime as dt

import pytest

from daypage import clock
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def add(client, note_id, color):
    return client.post(f"/api/notes/{note_id}/colors", {"color": color}, content_type="application/json")


def colors(client, note_id):
    return client.get(f"/api/notes/{note_id}").json()["colors"]


def test_new_note_has_no_colors():
    owner = login_as(1)
    note_id = create_note(owner)
    assert colors(owner, note_id) == []


def test_member_adds_color_and_everyone_sees_it():
    owner = login_as(1)
    note_id = create_note(owner)
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    res = add(guest, note_id, "#16794F")
    assert res.status_code == 200
    assert res.json()["colors"] == ["#16794f"]
    assert colors(owner, note_id) == ["#16794f"]


def test_colors_keep_the_order_they_were_added():
    owner = login_as(1)
    note_id = create_note(owner)
    for c in ("#111111", "#222222", "#333333"):
        add(owner, note_id, c)
    assert colors(owner, note_id) == ["#111111", "#222222", "#333333"]


def test_adding_the_same_color_again_changes_nothing():
    owner = login_as(1)
    note_id = create_note(owner)
    add(owner, note_id, "#abcdef")
    res = add(owner, note_id, "#ABCDEF")
    assert res.status_code == 200
    assert res.json()["colors"] == ["#abcdef"]


def test_ninth_color_is_refused():
    owner = login_as(1)
    note_id = create_note(owner)
    for i in range(8):
        assert add(owner, note_id, f"#00000{i}").status_code == 200
    res = add(owner, note_id, "#ffffff")
    assert res.status_code == 400
    assert res.json()["code"] == "colors_full"
    assert len(colors(owner, note_id)) == 8


@pytest.mark.parametrize("bad", ["red", "#fff", "#12345g", "123456", "#1234567", ""])
def test_malformed_color_is_refused(bad):
    owner = login_as(1)
    note_id = create_note(owner)
    res = add(owner, note_id, bad)
    assert res.status_code == 400
    assert res.json()["code"] == "bad_color"


def test_non_member_cannot_add():
    owner = login_as(1)
    note_id = create_note(owner)
    res = add(login_as(2), note_id, "#123456")
    assert res.status_code == 403
    assert colors(owner, note_id) == []


def test_colors_stay_after_midnight(monkeypatch):
    owner = login_as(1)
    note_id = create_note(owner)
    add(owner, note_id, "#123456")
    later = dt.datetime(2030, 1, 2, 9, 0, tzinfo=clock.KST)
    monkeypatch.setattr(clock, "now", lambda: later)
    assert colors(owner, note_id) == ["#123456"]
