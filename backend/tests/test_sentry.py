import pytest
import sentry_sdk

from config.sentry import init_sentry


@pytest.fixture
def init_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    return calls


def test_enabled_in_production_with_dsn(init_calls):
    assert init_sentry("https://key@glitchtip.example/1", debug=False, environment="production") is True
    assert init_calls[0]["dsn"] == "https://key@glitchtip.example/1"
    assert init_calls[0]["environment"] == "production"
    assert init_calls[0]["send_default_pii"] is False


def test_disabled_without_dsn(init_calls):
    assert init_sentry("", debug=False, environment="production") is False
    assert init_calls == []


def test_disabled_in_debug_even_with_dsn(init_calls):
    """로컬 .env에 DSN이 있어도 개발·테스트 오류는 보내지 않는다."""
    assert init_sentry("https://key@glitchtip.example/1", debug=True, environment="production") is False
    assert init_calls == []
