import pytest
from django.test import Client

from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def test_create_note_returns_unguessable_id_and_share_url(settings):
    settings.PUBLIC_ORIGIN = "https://daypage.sandcorp.co.kr"
    client = login_as(1)
    res = client.post("/api/notes", {}, content_type="application/json")
    assert res.status_code == 200
    body = res.json()
    assert len(body["id"]) == 32
    assert body["url"] == f"https://daypage.sandcorp.co.kr/note/{body['id']}"


def test_note_ids_are_unique():
    client = login_as(1)
    ids = {create_note(client) for _ in range(5)}
    assert len(ids) == 5


def test_new_note_has_default_name_and_creator_is_owner_member():
    client = login_as(1)
    note_id = create_note(client)
    notes = client.get("/api/me").json()["notes"]
    assert notes == [
        {"id": note_id, "name": "이름 없는 노트", "isOwner": True, "memberCount": 1, "memberLimit": None}
    ]


def test_create_note_with_name():
    client = login_as(1)
    create_note(client, name="  우리집 공용 노트  ")
    assert client.get("/api/me").json()["notes"][0]["name"] == "우리집 공용 노트"


def test_create_note_requires_login():
    res = Client().post("/api/notes", {}, content_type="application/json")
    assert res.status_code == 401


def test_my_notes_include_joined_notes_marked_not_owner():
    owner = login_as(1)
    note_id = create_note(owner, name="공용")
    guest = login_as(2)
    assert guest.get(f"/api/notes/{note_id}").status_code == 200

    guest_notes = guest.get("/api/me").json()["notes"]
    assert [(n["id"], n["isOwner"], n["memberCount"]) for n in guest_notes] == [(note_id, False, 2)]
    assert owner.get("/api/me").json()["notes"][0]["isOwner"] is True


def test_my_notes_are_most_recently_visited_first():
    client = login_as(1)
    first = create_note(client, name="첫째")
    second = create_note(client, name="둘째")
    client.get(f"/api/notes/{first}")
    assert [n["id"] for n in client.get("/api/me").json()["notes"]] == [first, second]


def test_preview_is_public_and_shows_name_only():
    owner = login_as(1)
    note_id = create_note(owner, name="우리집 공용 노트")
    res = Client().get(f"/api/notes/{note_id}/preview")
    assert res.status_code == 200
    assert res.json() == {"name": "우리집 공용 노트", "online": 0, "isFull": False}


def test_other_note_apis_require_login():
    owner = login_as(1)
    note_id = create_note(owner)
    assert Client().get(f"/api/notes/{note_id}").status_code == 401


def test_unknown_note_is_404():
    client = login_as(1)
    assert client.get("/api/notes/doesnotexist/preview").status_code == 404
    assert client.get("/api/notes/doesnotexist").status_code == 404
