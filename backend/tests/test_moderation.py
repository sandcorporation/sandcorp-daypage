"""운영 조치: 운영자가 노트를 읽기 전용으로 보고(열람 기록), 노트를 닫고, 사용자를 정지한다.
노트를 만든 사람은 참여자를 내보낸다(내보낸 사람은 다시 들어오지 못한다, 다시 허용할 수 있다)."""

import datetime as dt

import pytest
from django.test import Client
from pycrdt import Doc, Map

from daypage import clock, pages
from daypage.models import AdminLog, Note, NoteBan, NoteMember, Page, PageUpdate, User
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def staff(kakao_id: int = 900) -> Client:
    client = login_as(kakao_id)
    User.objects.filter(kakao_id=kakao_id).update(is_staff=True)
    return client


def user_id(kakao_id: int) -> int:
    return User.objects.get(kakao_id=kakao_id).id


def doc_bytes(text: str) -> bytes:
    doc = Doc()
    doc["meta"] = Map({"memo": text})
    return doc.get_update()


def note_with_guest():
    owner = login_as(1)
    note_id = create_note(owner, name="우리 노트")
    guest = login_as(2)
    assert guest.get(f"/api/notes/{note_id}").status_code == 200
    return owner, guest, note_id


# ── 운영자가 노트를 읽기 전용으로 본다 ─────────────────────────


def test_staff_sees_note_detail_with_members_and_pages_and_it_is_logged():
    owner, guest, note_id = note_with_guest()
    note = Note.objects.get(pk=note_id)
    yesterday = clock.today_kst() - dt.timedelta(days=1)
    Page.objects.create(note=note, date=yesterday, state=doc_bytes("어제"), sealed_at=clock.now(), is_empty=False)
    admin = staff()

    res = admin.get(f"/api/admin/notes/{note_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "우리 노트"
    assert body["ownerId"] == user_id(1)
    assert [m["nickname"] for m in body["members"]] == list(
        NoteMember.objects.filter(note_id=note_id).order_by("joined_at").values_list("nickname", flat=True)
    )
    assert body["openPage"] == clock.today_kst().isoformat()
    assert [p["date"] for p in body["pages"]] == [yesterday.isoformat()]
    assert body["closed"] is None

    log = AdminLog.objects.get()
    assert log.action == "view_note"
    assert log.staff.kakao_id == 900
    assert log.note_id == note_id


def test_staff_reads_today_and_sealed_pages_as_document_bytes():
    owner, guest, note_id = note_with_guest()
    note = Note.objects.get(pk=note_id)
    today = clock.today_kst()
    page = pages.open_page(note)  # 참여자가 들어오며 이미 열린 오늘 장
    PageUpdate.objects.create(page=page, update=doc_bytes("오늘 메모"))
    admin = staff()

    res = admin.get(f"/api/admin/notes/{note_id}/pages/{today.isoformat()}")
    assert res.status_code == 200
    got = Doc()
    got.apply_update(res.content)
    assert got.get("meta", type=Map)["memo"] == "오늘 메모"
    assert AdminLog.objects.filter(action="view_page", detail=today.isoformat()).exists()
    # 운영자가 본 것으로 참여자가 되지는 않는다
    assert not NoteMember.objects.filter(note_id=note_id, user__kakao_id=900).exists()


def test_only_staff_use_moderation_api():
    owner, guest, note_id = note_with_guest()
    assert owner.get(f"/api/admin/notes/{note_id}").status_code == 401
    assert owner.post(f"/api/admin/notes/{note_id}/close", {"reason": "x"}, content_type="application/json").status_code == 401
    assert Client().get(f"/api/admin/notes/{note_id}").status_code == 401


# ── 노트 닫기·다시 열기 ────────────────────────────────────────


def test_closed_note_cannot_be_opened_by_members_until_reopened():
    owner, guest, note_id = note_with_guest()
    admin = staff()
    res = admin.post(f"/api/admin/notes/{note_id}/close", {"reason": "광고 글"}, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["closed"]["reason"] == "광고 글"

    for client in (owner, guest):
        res = client.get(f"/api/notes/{note_id}")
        assert res.status_code == 403
        assert res.json()["code"] == "note_closed"
        assert "광고 글" in res.json()["detail"]
    # 다른 참여자 기능도 막힌다
    assert guest.post(f"/api/notes/{note_id}/colors", {"color": "#16794f"}, content_type="application/json").status_code == 403
    assert login_as(3).get(f"/api/notes/{note_id}").json()["code"] == "note_closed"

    assert admin.post(f"/api/admin/notes/{note_id}/reopen").status_code == 200
    assert guest.get(f"/api/notes/{note_id}").status_code == 200
    assert list(AdminLog.objects.order_by("id").values_list("action", flat=True))[-2:] == ["close_note", "reopen_note"]


def test_closing_needs_a_reason():
    owner, guest, note_id = note_with_guest()
    res = staff().post(f"/api/admin/notes/{note_id}/close", {"reason": "  "}, content_type="application/json")
    assert res.status_code == 400


# ── 사용자 정지 ────────────────────────────────────────────────


def test_suspended_user_cannot_open_or_create_notes_and_sees_why():
    owner, guest, note_id = note_with_guest()
    admin = staff()
    res = admin.post(f"/api/admin/users/{user_id(2)}/suspend", {"days": 7, "reason": "욕설"}, content_type="application/json")
    assert res.status_code == 200
    until = dt.datetime.fromisoformat(res.json()["suspension"]["until"])
    assert dt.timedelta(days=6, hours=23) < until - clock.now() <= dt.timedelta(days=7)

    res = guest.get(f"/api/notes/{note_id}")
    assert res.status_code == 403
    assert res.json()["code"] == "suspended"
    assert guest.post("/api/notes", {}, content_type="application/json").json()["code"] == "suspended"
    me = guest.get("/api/me").json()
    assert me["suspension"]["reason"] == "욕설"
    # 다른 사람은 그대로
    assert owner.get(f"/api/notes/{note_id}").status_code == 200

    assert admin.post(f"/api/admin/users/{user_id(2)}/unsuspend").status_code == 200
    assert guest.get(f"/api/notes/{note_id}").status_code == 200
    assert guest.get("/api/me").json()["suspension"] is None


def test_permanent_suspension_and_expired_suspension():
    owner, guest, note_id = note_with_guest()
    admin = staff()
    res = admin.post(f"/api/admin/users/{user_id(2)}/suspend", {"days": None, "reason": "반복 위반"}, content_type="application/json")
    assert res.json()["suspension"]["until"] is None
    assert guest.get(f"/api/notes/{note_id}").json()["code"] == "suspended"

    User.objects.filter(kakao_id=2).update(suspended_until=clock.now() - dt.timedelta(minutes=1), suspension_permanent=False)
    assert guest.get(f"/api/notes/{note_id}").status_code == 200


def test_staff_cannot_be_suspended_and_days_are_checked():
    admin = staff()
    staff(901)
    login_as(2)
    assert admin.post(f"/api/admin/users/{user_id(901)}/suspend", {"days": 1, "reason": "x"}, content_type="application/json").status_code == 400
    assert admin.post(f"/api/admin/users/{user_id(2)}/suspend", {"days": 3, "reason": "x"}, content_type="application/json").status_code == 422
    assert admin.post(f"/api/admin/users/{user_id(2)}/suspend", {"days": 1, "reason": ""}, content_type="application/json").status_code == 400


def test_admin_lists_show_closed_and_suspended_state():
    owner, guest, note_id = note_with_guest()
    admin = staff()
    admin.post(f"/api/admin/notes/{note_id}/close", {"reason": "광고"}, content_type="application/json")
    admin.post(f"/api/admin/users/{user_id(2)}/suspend", {"days": 1, "reason": "욕설"}, content_type="application/json")
    notes = {n["id"]: n for n in admin.get("/api/admin/notes").json()}
    assert notes[note_id]["closed"] is True
    users = {u["id"]: u for u in admin.get("/api/admin/users").json()}
    assert users[user_id(2)]["suspended"] is True
    assert users[user_id(1)]["suspended"] is False
    logs = admin.get("/api/admin/logs").json()
    assert [l["action"] for l in logs][:2] == ["suspend_user", "close_note"]


def test_staff_sees_a_user_with_their_notes():
    owner, guest, note_id = note_with_guest()
    body = staff().get(f"/api/admin/users/{user_id(2)}").json()
    assert body["suspension"] is None
    assert [n["id"] for n in body["notes"]] == [note_id]
    assert body["notes"][0]["isOwner"] is False


# ── 노트 주인이 참여자를 내보낸다 ──────────────────────────────


def test_owner_lists_members_and_kicks_one_who_cannot_come_back_until_allowed():
    owner, guest, note_id = note_with_guest()
    members = owner.get(f"/api/notes/{note_id}/members").json()
    assert [m["isOwner"] for m in members["members"]] == [True, False]
    target = members["members"][1]

    res = owner.post(f"/api/notes/{note_id}/members/{target['id']}/kick")
    assert res.status_code == 200
    assert not NoteMember.objects.filter(note_id=note_id, user__kakao_id=2).exists()
    res = guest.get(f"/api/notes/{note_id}")
    assert res.status_code == 403
    assert res.json()["code"] == "kicked"

    bans = owner.get(f"/api/notes/{note_id}/members").json()["kicked"]
    assert [b["nickname"] for b in bans] == [target["nickname"]]
    assert owner.delete(f"/api/notes/{note_id}/kicked/{bans[0]['id']}").status_code == 204
    assert guest.get(f"/api/notes/{note_id}").status_code == 200
    assert not NoteBan.objects.exists()


def test_only_owner_kicks_and_not_themselves():
    owner, guest, note_id = note_with_guest()
    members = owner.get(f"/api/notes/{note_id}/members").json()["members"]
    me, other = members[0], members[1]
    assert guest.get(f"/api/notes/{note_id}/members").status_code == 403
    assert guest.post(f"/api/notes/{note_id}/members/{me['id']}/kick").status_code == 403
    assert owner.post(f"/api/notes/{note_id}/members/{me['id']}/kick").status_code == 400
    assert NoteMember.objects.filter(pk=other["id"]).exists()


def test_reopening_the_same_page_within_a_minute_is_logged_once():
    owner, guest, note_id = note_with_guest()
    admin = staff()
    admin.get(f"/api/admin/notes/{note_id}")
    admin.get(f"/api/admin/notes/{note_id}")
    assert AdminLog.objects.filter(action="view_note").count() == 1
