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


def _docs_statuses(debug: str) -> str:
    import os
    import subprocess
    import sys

    code = (
        "import django; django.setup()\n"
        "from django.test import Client\n"
        "c = Client(HTTP_HOST='localhost')\n"
        "print([c.get(p).status_code for p in ('/api/docs','/api/openapi.json','/api/health')])\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60,
                         env={**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings", "DJANGO_DEBUG": debug, "DJANGO_ALLOWED_HOSTS": "localhost"})
    return out.stdout.strip() + out.stderr


def test_docs_and_openapi_closed_in_prod():
    """운영(DEBUG=False)으로 새 프로세스를 띄워 /api/docs·/api/openapi.json이 꺼졌는지 본다(#110).
    pytest-django는 DEBUG를 항상 끄므로 같은 프로세스로는 열린 쪽을 볼 수 없다."""
    assert _docs_statuses("0").endswith("[404, 404, 200]")


def test_docs_open_in_debug():
    assert _docs_statuses("1").endswith("[200, 200, 200]")
