from urllib.parse import parse_qs, urlparse

import pytest

from daypage import kakao
from daypage.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def fake_kakao(monkeypatch):
    """카카오 토큰 교환·회원 조회를 대체한다. 받은 code를 회원번호로 돌려준다."""
    calls = []

    def fetch_kakao_id(code: str) -> int:
        calls.append(code)
        if code == "bad":
            raise kakao.KakaoError("invalid code")
        return int(code)

    monkeypatch.setattr(kakao, "fetch_kakao_id", fetch_kakao_id)
    return calls


def start_login(client, next_path):
    res = client.get("/auth/kakao/login", {"next": next_path})
    assert res.status_code == 302
    query = parse_qs(urlparse(res["Location"]).query)
    return res, query["state"][0]


def test_login_redirects_to_kakao_authorize_with_state(client):
    res, state = start_login(client, "/note/abc")
    url = urlparse(res["Location"])
    query = parse_qs(url.query)
    assert url.netloc == "kauth.kakao.com"
    assert url.path == "/oauth/authorize"
    assert query["client_id"] == ["test-rest-key"]
    assert query["redirect_uri"] == ["http://testserver/auth/kakao/callback"]
    assert query["response_type"] == ["code"]
    assert "scope" not in query
    assert len(state) >= 16


def test_callback_logs_in_and_returns_to_next(client, fake_kakao):
    _, state = start_login(client, "/note/abc")
    res = client.get("/auth/kakao/callback", {"code": "1234", "state": state})
    assert res.status_code == 302
    assert res["Location"] == "/note/abc"
    assert client.get("/api/me").json()["authenticated"] is True


def test_callback_with_mismatched_state_is_rejected(client, fake_kakao):
    start_login(client, "/note/abc")
    res = client.get("/auth/kakao/callback", {"code": "1234", "state": "forged"})
    assert res.status_code == 400
    assert fake_kakao == []
    assert client.get("/api/me").json()["authenticated"] is False


def test_callback_without_started_login_is_rejected(client, fake_kakao):
    res = client.get("/auth/kakao/callback", {"code": "1234", "state": "anything"})
    assert res.status_code == 400


def test_state_cannot_be_reused(client, fake_kakao):
    _, state = start_login(client, "/")
    client.get("/auth/kakao/callback", {"code": "1234", "state": state})
    client.post("/auth/logout")
    res = client.get("/auth/kakao/callback", {"code": "1234", "state": state})
    assert res.status_code == 400


def test_kakao_failure_is_reported_without_login(client, fake_kakao):
    _, state = start_login(client, "/note/abc")
    res = client.get("/auth/kakao/callback", {"code": "bad", "state": state})
    assert res.status_code == 502
    assert client.get("/api/me").json()["authenticated"] is False


def test_user_cancelling_consent_returns_to_next_without_login(client, fake_kakao):
    _, state = start_login(client, "/note/abc")
    res = client.get("/auth/kakao/callback", {"error": "access_denied", "state": state})
    assert res.status_code == 302
    assert res["Location"] == "/note/abc"
    assert client.get("/api/me").json()["authenticated"] is False


@pytest.mark.parametrize(
    "next_path",
    ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", "note/abc"],
)
def test_external_next_falls_back_to_root(client, fake_kakao, next_path):
    _, state = start_login(client, next_path)
    res = client.get("/auth/kakao/callback", {"code": "1234", "state": state})
    assert res["Location"] == "/"


def test_same_kakao_id_twice_creates_one_user(client, fake_kakao):
    for _ in range(2):
        _, state = start_login(client, "/")
        client.get("/auth/kakao/callback", {"code": "777", "state": state})
        client.post("/auth/logout")
    assert User.objects.filter(kakao_id=777).count() == 1


def test_logout_ends_session(client, fake_kakao):
    _, state = start_login(client, "/")
    client.get("/auth/kakao/callback", {"code": "1234", "state": state})
    res = client.post("/auth/logout")
    assert res.status_code == 204
    assert client.get("/api/me").json()["authenticated"] is False


def test_me_for_anonymous(client):
    assert client.get("/api/me").json() == {"authenticated": False, "notes": []}
