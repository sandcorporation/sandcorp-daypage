"""실시간 알림이 실패해도 이미 저장한 동작은 성공이다(#254). 실패는 예외와 함께 로그에 남는다."""

import datetime as dt
import logging

import pytest
from channels.layers import get_channel_layer

from daypage import clock, membership, sealing
from daypage.models import Note, NoteBan, NoteMember, User
from tests.helpers import create_note, login_as

# 커밋 뒤 콜백이 실제처럼 요청 안에서 돌아야 한다.
pytestmark = pytest.mark.django_db(transaction=True)

TODAY = dt.datetime(2026, 10, 16, 15, 0, tzinfo=clock.KST)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "now", lambda: TODAY)


@pytest.fixture
def sends(monkeypatch):
    """channel layer의 group_send가 늘 실패한다. 보내려던 (그룹, 알림 종류)를 모은다."""
    tried: list[tuple[str, str]] = []

    async def broken(self, group, message):
        tried.append((group, message["type"]))
        raise ConnectionError("실시간 알림 서버에 닿지 않아요")

    monkeypatch.setattr(type(get_channel_layer()), "group_send", broken)
    return tried


def note_with_guest():
    owner = login_as(1)
    note_id = create_note(owner, name="우리 노트")
    assert login_as(2).get(f"/api/notes/{note_id}").status_code == 200
    guest = NoteMember.objects.get(note_id=note_id, user__kakao_id=2)
    return owner, guest, note_id


def staff():
    client = login_as(900)
    User.objects.filter(kakao_id=900).update(is_staff=True)
    return client


def patch(client, path, body):
    return client.patch(path, body, content_type="application/json")


def assert_logged(caplog, kind: str) -> None:
    records = [r for r in caplog.records if r.name == "daypage.broadcast" and kind in r.getMessage()]
    assert records, caplog.text
    assert records[0].levelno == logging.ERROR
    assert records[0].exc_info[0] is ConnectionError


def test_kick_succeeds_when_notice_fails(sends, caplog):
    owner, guest, note_id = note_with_guest()

    res = owner.post(f"/api/notes/{note_id}/members/{guest.id}/kick")

    assert res.status_code == 200, res.content
    assert not NoteMember.objects.filter(pk=guest.id).exists()
    assert NoteBan.objects.filter(note_id=note_id, user_id=guest.user_id).exists()
    # 내보내기 알림이 실패해도 머리말 알림까지 이어서 보내 본다
    assert [kind for _, kind in sends][-2:] == ["member.kicked", "note.info"]
    assert_logged(caplog, "member.kicked")
    assert_logged(caplog, "note.info")


@pytest.mark.parametrize(
    ("body", "field", "saved"),
    [({"memberLimit": 5}, "member_limit", 5), ({"name": "새 이름"}, "name", "새 이름")],
)
def test_note_change_succeeds_when_notice_fails(sends, body, field, saved):
    owner, _, note_id = note_with_guest()

    res = patch(owner, f"/api/notes/{note_id}", body)

    assert res.status_code == 200, res.content
    assert getattr(Note.objects.get(pk=note_id), field) == saved
    assert sends[-1] == (f"note.{note_id}", "note.info")


@pytest.mark.parametrize(
    ("seal_hour", "kind"),
    # 지금(15시) 뒤로 옮기면 예정 시각 알림, 이미 지난 시각이면 바로 봉인하고 교체 알림
    [(18, "note.page"), (14, "page.rolled")],
)
def test_seal_hour_change_succeeds_when_notice_fails(sends, monkeypatch, seal_hour, kind):
    monkeypatch.setattr(clock, "now", lambda: TODAY - dt.timedelta(hours=2))
    owner, _, note_id = note_with_guest()
    monkeypatch.setattr(clock, "now", lambda: TODAY)

    res = patch(owner, f"/api/notes/{note_id}", {"sealHour": seal_hour})

    assert res.status_code == 200, res.content
    assert Note.objects.get(pk=note_id).seal_hour == seal_hour
    assert (f"note.{note_id}", kind) in sends


def test_paper_change_succeeds_when_notice_fails(sends):
    owner, _, note_id = note_with_guest()

    res = patch(owner, f"/api/notes/{note_id}/paper", {"pattern": "grid"})

    assert res.status_code == 200, res.content
    assert Note.objects.get(pk=note_id).paper["pattern"] == "grid"
    assert sends[-1] == (f"note.{note_id}", "note.paper")


def test_note_delete_succeeds_when_notice_fails(sends):
    owner, _, note_id = note_with_guest()

    res = owner.delete(f"/api/notes/{note_id}")

    assert res.status_code == 204, res.content
    assert not Note.objects.filter(pk=note_id).exists()
    assert sends[-1] == (f"note.{note_id}", "note.deleted")


def test_staff_closing_note_succeeds_when_notice_fails(sends, caplog):
    _, _, note_id = note_with_guest()

    res = staff().post(f"/api/admin/notes/{note_id}/close", {"reason": "광고"}, content_type="application/json")

    assert res.status_code == 200, res.content
    assert Note.objects.get(pk=note_id).closed_at is not None
    assert_logged(caplog, "note.closed")


def test_staff_suspending_user_succeeds_when_notice_fails(sends, caplog):
    _, guest, _ = note_with_guest()

    res = staff().post(
        f"/api/admin/users/{guest.user_id}/suspend", {"days": 1, "reason": "욕설"}, content_type="application/json"
    )

    assert res.status_code == 200, res.content
    assert User.objects.get(pk=guest.user_id).suspended_until is not None
    assert_logged(caplog, "user.suspended")


def test_note_change_succeeds_when_reading_header_for_notice_fails(monkeypatch):
    owner, _, note_id = note_with_guest()

    def broken(_note_id):
        raise RuntimeError("머리말을 읽지 못했어요")

    monkeypatch.setattr(membership, "current_info", broken)

    res = patch(owner, f"/api/notes/{note_id}", {"name": "새 이름"})

    assert res.status_code == 200, res.content
    assert Note.objects.get(pk=note_id).name == "새 이름"


def test_one_failed_roll_notice_does_not_stop_the_next_note(sends, caplog):
    sealing.announce_roll({"first", "second"}, "2026-10-16")

    assert sorted(sends) == [("note.first", "page.rolled"), ("note.second", "page.rolled")]
    assert_logged(caplog, "page.rolled")
