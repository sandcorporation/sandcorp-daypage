"""만든 사람만 하는 동작(이름·정원 바꾸기, 지우기, 참여자 보기·내보내기·다시 허용)도
닫힌 노트와 정지된 사용자에게는 note_detail과 같이 막힌다(#164)."""

import pytest
from django.utils import timezone

from daypage.models import Note, NoteBan, NoteMember, User
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db


def setup():
    owner = login_as(1)
    note_id = create_note(owner)
    guest = login_as(2)
    assert guest.get(f"/api/notes/{note_id}").status_code == 200
    kicked = login_as(3)
    assert kicked.get(f"/api/notes/{note_id}").status_code == 200
    note = Note.objects.get(pk=note_id)
    ban = NoteBan.objects.create(note=note, user=User.objects.get(kakao_id=3), nickname="나간 사람")
    NoteMember.objects.filter(note=note, user__kakao_id=3).delete()
    member_id = NoteMember.objects.get(note=note, user__kakao_id=2).id
    return owner, note_id, member_id, ban.id


ACTIONS = {
    "update_note": (lambda c, n, m, b: c.patch(f"/api/notes/{n}", {"name": "새 이름"}, content_type="application/json"), 200),
    "delete_note": (lambda c, n, m, b: c.delete(f"/api/notes/{n}"), 204),
    "note_members": (lambda c, n, m, b: c.get(f"/api/notes/{n}/members"), 200),
    "kick_member": (lambda c, n, m, b: c.post(f"/api/notes/{n}/members/{m}/kick"), 200),
    "allow_again": (lambda c, n, m, b: c.delete(f"/api/notes/{n}/kicked/{b}"), 204),
}


def close(note_id: str) -> None:
    Note.objects.filter(pk=note_id).update(closed_at=timezone.now(), closed_reason="광고 글")


def suspend_owner(note_id: str) -> None:
    User.objects.filter(kakao_id=1).update(suspension_permanent=True, suspension_reason="도배")


STATES = {
    "normal": (lambda note_id: None, None),
    "closed": (close, "note_closed"),
    "suspended": (suspend_owner, "suspended"),
}


@pytest.mark.parametrize("state", STATES)
@pytest.mark.parametrize("action", ACTIONS)
def test_owner_actions_follow_moderation(state, action):
    owner, note_id, member_id, ban_id = setup()
    apply, blocked_code = STATES[state]
    apply(note_id)
    call, ok_status = ACTIONS[action]

    res = call(owner, note_id, member_id, ban_id)

    if blocked_code is None:
        assert res.status_code == ok_status, res.content
    else:
        assert res.status_code == 403
        assert res.json()["code"] == blocked_code
        assert Note.objects.filter(pk=note_id).exists()
        assert NoteMember.objects.filter(pk=member_id).exists()
        assert NoteBan.objects.filter(pk=ban_id).exists()


def test_closed_note_tells_the_reason_like_note_detail():
    owner, note_id, _, _ = setup()
    close(note_id)
    detail = owner.get(f"/api/notes/{note_id}").json()
    assert owner.patch(f"/api/notes/{note_id}", {"name": "x"}, content_type="application/json").json() == detail


def test_non_owner_still_gets_not_owner():
    _, note_id, _, _ = setup()
    res = login_as(2).patch(f"/api/notes/{note_id}", {"name": "x"}, content_type="application/json")
    assert res.status_code == 403
    assert res.json()["code"] == "not_owner"
