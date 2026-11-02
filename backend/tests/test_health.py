def test_health_returns_ok(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_client_config_without_frontend_dsn(client, settings):
    settings.SENTRY_FRONTEND_DSN = ""
    res = client.get("/api/client-config")
    assert res.status_code == 200
    assert res.json()["sentryDsn"] is None


def test_client_config_hands_out_frontend_dsn(client, settings):
    """프론트는 빌드에 DSN을 넣지 않고 실행할 때 받아 간다(로그인 없이)."""
    settings.SENTRY_FRONTEND_DSN = "https://key@glitchtip.example/2"
    settings.SENTRY_ENVIRONMENT = "production"
    res = client.get("/api/client-config")
    assert res.json()["sentryDsn"] == "https://key@glitchtip.example/2"
    assert res.json()["environment"] == "production"


def test_docs_and_openapi_closed_in_prod(client):
    """pytest-django는 DEBUG=False(운영과 같음)로 URLconf를 읽으므로 실제 라우팅이 꺼져 있어야 한다(#110)."""
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_docs_urls_follow_debug():
    from daypage.api import docs_kwargs

    assert docs_kwargs(True) == {"docs_url": "/docs", "openapi_url": "/openapi.json"}
    assert docs_kwargs(False) == {"docs_url": None, "openapi_url": None}
