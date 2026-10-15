import threading

import pytest
from django.db import connection
from django.test import Client

from daypage.models import NoteMember
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def patch(client, note_id, body):
    return client.patch(f"/api/notes/{note_id}", body, content_type="application/json")


def test_note_is_unlimited_by_default():
    owner = login_as(1)
    note_id = create_note(owner)
    assert owner.get(f"/api/notes/{note_id}").json()["memberLimit"] is None


def test_third_person_is_refused_when_limit_is_two():
    owner = login_as(1)
    note_id = create_note(owner, memberLimit=2)
    assert login_as(2).get(f"/api/notes/{note_id}").status_code == 200
    res = login_as(3).get(f"/api/notes/{note_id}")
    assert res.status_code == 403
    assert res.json()["code"] == "note_full"
    assert NoteMember.objects.filter(note_id=note_id).count() == 2


def test_existing_member_keeps_access_after_note_is_full():
    owner = login_as(1)
    note_id = create_note(owner, memberLimit=2)
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    login_as(3).get(f"/api/notes/{note_id}")
    assert guest.get(f"/api/notes/{note_id}").status_code == 200
    assert owner.get(f"/api/notes/{note_id}").status_code == 200


def test_preview_says_when_note_is_full():
    owner = login_as(1)
    note_id = create_note(owner, memberLimit=2)
    assert Client().get(f"/api/notes/{note_id}/preview").json()["isFull"] is False
    login_as(2).get(f"/api/notes/{note_id}")
    assert Client().get(f"/api/notes/{note_id}/preview").json()["isFull"] is True


def test_limit_cannot_go_below_current_members():
    owner = login_as(1)
    note_id = create_note(owner)
    for kakao_id in (2, 3):
        login_as(kakao_id).get(f"/api/notes/{note_id}")
    res = patch(owner, note_id, {"memberLimit": 2})
    assert res.status_code == 400
    assert res.json()["code"] == "limit_below_members"
    assert patch(owner, note_id, {"memberLimit": 4}).status_code == 200
    assert owner.get(f"/api/notes/{note_id}").json()["memberLimit"] == 4
    assert patch(owner, note_id, {"memberLimit": None}).status_code == 200
    assert owner.get(f"/api/notes/{note_id}").json()["memberLimit"] is None


def test_renaming_does_not_touch_limit():
    owner = login_as(1)
    note_id = create_note(owner, memberLimit=3)
    patch(owner, note_id, {"name": "새 이름"})
    assert owner.get(f"/api/notes/{note_id}").json()["memberLimit"] == 3


@pytest.mark.parametrize("limit", [0, 1, -5])
def test_limit_must_be_at_least_two(limit):
    owner = login_as(1)
    res = owner.post("/api/notes", {"memberLimit": limit}, content_type="application/json")
    assert res.status_code in (400, 422)
    note_id = create_note(owner)
    assert patch(owner, note_id, {"memberLimit": limit}).status_code in (400, 422)


def test_only_owner_can_change_limit():
    owner = login_as(1)
    note_id = create_note(owner)
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    assert patch(guest, note_id, {"memberLimit": 5}).status_code == 403


def test_my_notes_show_member_limit():
    owner = login_as(1)
    create_note(owner, memberLimit=4)
    assert owner.get("/api/me").json()["notes"][0]["memberLimit"] == 4


@pytest.mark.django_db(transaction=True)
def test_two_people_racing_for_the_last_seat_only_one_gets_in():
    owner = login_as(1)
    note_id = create_note(owner, memberLimit=2)
    racers = [login_as(2), login_as(3)]
    barrier = threading.Barrier(2)
    statuses = []

    def enter(client):
        barrier.wait()
        statuses.append(client.get(f"/api/notes/{note_id}").status_code)
        connection.close()

    threads = [threading.Thread(target=enter, args=(c,)) for c in racers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(statuses) == [200, 403]
    assert NoteMember.objects.filter(note_id=note_id).count() == 2
