import pytest
import sentry_sdk
from django.core.exceptions import PermissionDenied, SuspiciousOperation
from django.core.management import CommandError, call_command
from django.http import Http404
from ninja.errors import HttpError
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport
from sentry_sdk.types import Event

from config.sentry import before_send, init_sentry, sentry_options

DSN = "https://key@glitchtip.example/1"
SHA = "0123456789abcdef0123456789abcdef01234567"


@pytest.fixture
def init_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    return calls


class FakeTransport(Transport):
    """네트워크 대신 봉투를 모은다. 보낸 이벤트(event 항목)만 꺼내 본다."""

    def __init__(self, options=None):
        super().__init__(options)
        self.events: list[Event] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        event = envelope.get_event()
        if event is not None:
            self.events.append(event)


@pytest.fixture
def sent():
    """운영과 같은 설정으로 SDK를 켜되 전송만 흉내 낸다. 끝나면 끈다(다른 시험은 꺼진 채 돈다)."""
    transport = FakeTransport()
    sentry_sdk.init(**sentry_options(DSN, environment="production", release=SHA), transport=transport)
    yield transport.events
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)


def test_enabled_in_production_with_dsn(init_calls):
    assert init_sentry(DSN, debug=False, environment="production", release=SHA) is True
    options = init_calls[0]
    assert options["dsn"] == DSN
    assert options["environment"] == "production"
    assert options["release"] == SHA
    assert options["send_default_pii"] is False
    assert options["include_local_variables"] is False
    assert options["max_request_body_size"] == "never"
    assert options["traces_sample_rate"] == 0
    assert options["before_send"] is before_send


def test_empty_release_is_none(init_calls):
    init_sentry(DSN, debug=False, environment="production", release="  ")
    assert init_calls[0]["release"] is None


def test_disabled_without_dsn(init_calls):
    assert init_sentry("", debug=False, environment="production") is False
    assert init_calls == []


def test_disabled_in_debug_even_with_dsn(init_calls):
    """로컬 .env에 DSN이 있어도 개발·테스트 오류는 보내지 않는다."""
    assert init_sentry(DSN, debug=True, environment="production") is False
    assert init_calls == []


def _hint(exc: BaseException):
    return {"exc_info": (type(exc), exc, None)}


@pytest.mark.parametrize(
    "exc",
    [Http404("x"), PermissionDenied("x"), SuspiciousOperation("x"), HttpError(403, "x"), HttpError(422, "x")],
    ids=["404", "permission", "suspicious", "ninja-403", "ninja-422"],
)
def test_intended_4xx_is_dropped(exc):
    assert before_send({"message": "x"}, _hint(exc)) is None


def test_5xx_and_plain_errors_are_sent():
    assert before_send({"message": "a"}, _hint(HttpError(503, "down"))) is not None
    assert before_send({"message": "b"}, _hint(RuntimeError("boom"))) is not None
    assert before_send({"message": "log"}, {}) is not None


def test_manage_shell_error_is_dropped():
    frame = {"module": "django.core.management.commands.shell", "filename": "shell.py"}
    event: Event = {"exception": {"values": [{"type": "NameError", "stacktrace": {"frames": [frame]}}]}}
    assert before_send(event, _hint(NameError("x"))) is None


def test_cookies_body_credential_headers_and_frame_vars_are_scrubbed():
    event: Event = {
        "request": {
            "url": "https://daypage.example/api/me",
            "cookies": {"sessionid": "s"},
            "data": {"password": "p"},
            "headers": {"Cookie": "sessionid=s", "Authorization": "Bearer t", "X-CSRFToken": "c", "User-Agent": "ua"},
        },
        "exception": {"values": [{"type": "E", "stacktrace": {"frames": [{"function": "f", "vars": {"token": "t"}}]}}]},
        "threads": {"values": [{"stacktrace": {"frames": [{"function": "g", "vars": {"k": "v"}}]}}]},
    }
    out = before_send(event, _hint(RuntimeError("boom")))
    assert out is not None
    assert "cookies" not in out["request"] and "data" not in out["request"]
    assert out["request"]["headers"] == {"User-Agent": "ua"}
    assert "vars" not in out["exception"]["values"][0]["stacktrace"]["frames"][0]
    assert "vars" not in out["threads"]["values"][0]["stacktrace"]["frames"][0]


def test_glitchtip_test_sends_one_event_with_release(sent, capsys):
    call_command("glitchtip_test", "연동 시험 daypage 2026-11-07")
    assert len(sent) == 1
    event = sent[0]
    exc = event["exception"]["values"][-1]
    assert exc["type"] == "GlitchTipOnboardingTest"
    assert exc["value"] == "연동 시험 daypage 2026-11-07"
    assert event["release"] == SHA
    assert event["environment"] == "production"
    assert f"id={event['event_id']}" in capsys.readouterr().out


def test_glitchtip_test_fails_when_sdk_is_off():
    """시험은 SDK가 꺼진 채 돈다(DEBUG·DSN 없음). 그때 명령은 보내지 않고 0이 아닌 코드로 끝난다."""
    assert not sentry_sdk.is_initialized()
    with pytest.raises(CommandError, match="꺼져"):
        call_command("glitchtip_test")
