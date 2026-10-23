import pytest

from daypage.models import Suggestion, User
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def staff(kakao_id: int = 900):
    client = login_as(kakao_id)
    User.objects.filter(kakao_id=kakao_id).update(is_staff=True)
    return client


# ── 건의 남기기(사용자) ─────────────────────────────────────────


def test_member_leaves_a_suggestion_from_a_note():
    client = login_as(1)
    note_id = create_note(client)
    res = client.post("/api/suggestions", {"text": "  지우개 크기를 고르고 싶어요  ", "noteId": note_id}, content_type="application/json")
    assert res.status_code == 201
    s = Suggestion.objects.get()
    assert s.text == "지우개 크기를 고르고 싶어요"
    assert s.note_id == note_id
    assert s.status == "new"


def test_suggestion_needs_login_and_text():
    from django.test import Client

    assert Client().post("/api/suggestions", {"text": "x"}, content_type="application/json").status_code == 401
    client = login_as(1)
    assert client.post("/api/suggestions", {"text": "   "}, content_type="application/json").status_code == 400
    assert client.post("/api/suggestions", {"text": "가" * 1001}, content_type="application/json").status_code == 400


def test_note_of_suggestion_is_kept_only_for_members():
    owner = login_as(1)
    note_id = create_note(owner)
    other = login_as(2)
    res = other.post("/api/suggestions", {"text": "좋아요", "noteId": note_id}, content_type="application/json")
    assert res.status_code == 201
    assert Suggestion.objects.get().note_id is None


def test_too_many_suggestions_in_a_day_are_refused(settings):
    settings.SUGGESTIONS_PER_DAY = 2
    client = login_as(1)
    for _ in range(2):
        assert client.post("/api/suggestions", {"text": "a"}, content_type="application/json").status_code == 201
    assert client.post("/api/suggestions", {"text": "a"}, content_type="application/json").status_code == 429


# ── 운영자 ──────────────────────────────────────────────────


def test_me_tells_whether_staff():
    assert login_as(1).get("/api/me").json()["isStaff"] is False
    assert staff().get("/api/me").json()["isStaff"] is True


@pytest.mark.parametrize("path", ["/api/admin/stats", "/api/admin/suggestions", "/api/admin/notes", "/api/admin/users"])
def test_admin_api_is_staff_only(path):
    from django.test import Client

    assert Client().get(path).status_code == 401
    assert login_as(1).get(path).status_code == 401


def test_stats_counts_users_notes_and_days():
    a = login_as(1)
    create_note(a)
    create_note(a)
    res = staff().get("/api/admin/stats")
    assert res.status_code == 200
    body = res.json()
    assert body["totals"]["users"] == 2  # 노트 만든 사람 + 운영자
    assert body["totals"]["notes"] == 2
    assert body["today"]["signups"] == 2
    assert body["today"]["notes"] == 2
    assert len(body["daily"]) == 14
    assert body["daily"][-1]["notes"] == 2
    assert len(body["hourly"]) == 24
    assert sum(h["signups"] for h in body["hourly"]) == 2
    assert "connections" in body["online"]


def test_staff_reads_and_marks_suggestions():
    client = login_as(1)
    note_id = create_note(client, name="우리집")
    client.post("/api/suggestions", {"text": "첫 건의", "noteId": note_id}, content_type="application/json")
    client.post("/api/suggestions", {"text": "둘째 건의"}, content_type="application/json")
    admin = staff()
    items = admin.get("/api/admin/suggestions").json()
    assert [s["text"] for s in items] == ["둘째 건의", "첫 건의"]
    assert items[1]["noteName"] == "우리집"
    sid = items[1]["id"]
    res = admin.patch(f"/api/admin/suggestions/{sid}", {"status": "reviewing"}, content_type="application/json")
    assert res.status_code == 200
    assert Suggestion.objects.get(pk=sid).status == "reviewing"
    assert [s["text"] for s in admin.get("/api/admin/suggestions?status=new").json()] == ["둘째 건의"]
    assert admin.patch(f"/api/admin/suggestions/{sid}", {"status": "nope"}, content_type="application/json").status_code == 422


def test_notes_and_users_lists_show_counts_not_content():
    owner = login_as(1)
    note_id = create_note(owner, name="공용 노트")
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    admin = staff()
    notes = admin.get("/api/admin/notes").json()
    assert notes[0]["id"] == note_id
    assert notes[0]["name"] == "공용 노트"
    assert notes[0]["memberCount"] == 2
    assert "state" not in notes[0]
    users = admin.get("/api/admin/users").json()
    by_id = {u["id"]: u for u in users}
    owner_id = User.objects.get(kakao_id=1).id
    assert by_id[owner_id]["ownedNotes"] == 1
    assert by_id[owner_id]["memberships"] == 1
    assert "kakaoId" not in by_id[owner_id]  # 카카오 회원번호는 보이지 않는다


def test_grant_staff_command_by_note_owner():
    from django.core.management import call_command

    owner = login_as(5)
    note_id = create_note(owner)
    # 노트 id는 '-'로 시작할 수 있어(무작위) 옵션과 값을 붙여 넘긴다.
    call_command("grant_staff", f"--note={note_id}")
    assert User.objects.get(kakao_id=5).is_staff is True
    call_command("grant_staff", str(User.objects.get(kakao_id=5).id), "--off")
    assert User.objects.get(kakao_id=5).is_staff is False
