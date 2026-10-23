import httpx
import pytest
from django.core.management import call_command

from daypage import suggestions, tasks
from daypage.models import Suggestion
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db

HOOK = "https://discord.test/webhook"


@pytest.fixture
def sent(settings, monkeypatch):
    """보낸 웹훅 본문들. Celery 대신 바로 보낸다."""
    settings.DISCORD_SUGGESTION_WEBHOOK = HOOK
    bodies = []

    def post(url, json, timeout):
        assert url == HOOK
        bodies.append(json)
        return httpx.Response(204)

    monkeypatch.setattr(suggestions.httpx, "post", post)
    monkeypatch.setattr(tasks.send_suggestion_alert, "delay", lambda *a: suggestions.send(*a))
    return bodies


def staff(kakao_id: int = 900):
    from daypage.models import User

    client = login_as(kakao_id)
    User.objects.filter(kakao_id=kakao_id).update(is_staff=True)
    return client


def leave(text="지우개 크기를 고르고 싶어요"):
    client = login_as(1)
    note_id = create_note(client)
    res = client.post("/api/suggestions", {"text": text, "noteId": note_id}, content_type="application/json")
    return Suggestion.objects.get(pk=res.json()["id"])


def test_new_suggestion_is_announced_after_commit(sent, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        s = leave("@everyone 지우개\n크기를 고르고 싶어요")
    assert len(sent) == 1
    content = sent[0]["content"]
    assert content.startswith(f"📮 **새 건의 #{s.id}** · ")
    assert "> @everyone 지우개\n> 크기를 고르고 싶어요" in content
    # 사용자가 쓴 멘션이 울리지 않는다
    assert sent[0]["allowed_mentions"] == {"parse": []}


def test_reviewing_and_done_from_staff_page_are_announced_but_others_are_not(sent, django_capture_on_commit_callbacks):
    s = leave()
    admin = staff()
    with django_capture_on_commit_callbacks(execute=True):
        for status in ["reviewing", "reviewing", "done", "declined", "new"]:
            assert admin.patch(f"/api/admin/suggestions/{s.id}", {"status": status}, content_type="application/json").status_code == 200
    assert [b["content"].split("\n")[0].split(" · ")[0] for b in sent] == [
        f"🔎 **건의 #{s.id} 검토 중**",
        f"✅ **건의 #{s.id} 반영함**",
    ]


def test_command_changes_status_with_a_note(sent, django_capture_on_commit_callbacks):
    s = leave()
    with django_capture_on_commit_callbacks(execute=True):
        call_command("suggestion_status", s.id, "reviewing")
        call_command("suggestion_status", s.id, "done", note="PR #50으로 배포했어요")
        call_command("suggestion_status", s.id, "done")  # 이미 반영함 — 다시 알리지 않는다
    s.refresh_from_db()
    assert s.status == "done"
    assert len(sent) == 2
    assert sent[1]["content"].endswith("PR #50으로 배포했어요")


def test_no_webhook_means_no_alert(settings, monkeypatch, django_capture_on_commit_callbacks):
    settings.DISCORD_SUGGESTION_WEBHOOK = ""
    monkeypatch.setattr(suggestions.httpx, "post", lambda *a, **k: pytest.fail("보내면 안 된다"))
    with django_capture_on_commit_callbacks(execute=True):
        leave()


def test_failed_webhook_does_not_raise(settings, monkeypatch):
    settings.DISCORD_SUGGESTION_WEBHOOK = HOOK
    s = leave()

    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(suggestions.httpx, "post", boom)
    assert suggestions.send(s.id, "new") is False
    monkeypatch.setattr(suggestions.httpx, "post", lambda *a, **k: httpx.Response(404))
    assert suggestions.send(s.id, "new") is False


def test_long_suggestion_fits_discord_limit():
    s = Suggestion(id=7, text="가" * 1000 + "\n" + "나" * 1000, status="new")
    assert len(suggestions.message(s, "done", "x" * 500)) <= 2000
