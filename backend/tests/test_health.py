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
