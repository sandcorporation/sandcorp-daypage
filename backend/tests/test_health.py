import uuid

import pytest
from django.db import connections
from django.db.utils import OperationalError

from daypage import health, tasks

# 아무도 듣지 않는 포트: 연결이 바로 거절된다.
DEAD_REDIS = "redis://127.0.0.1:1/0"


@pytest.fixture
def heartbeat_key(monkeypatch):
    """시험마다 따로 쓰는 생존 신호 키(같은 redis를 쓰는 개발용 워커의 신호와 섞이지 않게)."""
    key = f"daypage-test:heartbeat:{uuid.uuid4().hex}"
    monkeypatch.setattr(health, "HEARTBEAT_KEY", key)
    r = health._redis()  # 시험이 REDIS_URL을 죽은 곳으로 바꿔도 지울 수 있게 미리 잡는다
    yield key
    with r:
        r.delete(key)


@pytest.fixture
def db_down(monkeypatch):
    def refuse(self, *args, **kwargs):
        raise OperationalError("connection refused")

    monkeypatch.setattr(type(connections["default"]), "cursor", refuse)


@pytest.mark.django_db
def test_health_ok_when_db_redis_and_worker_alive(client, heartbeat_key):
    tasks.heartbeat()  # worker가 beat의 작업을 실행한 것과 같다
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@pytest.mark.django_db
def test_health_503_without_worker_heartbeat(client, heartbeat_key):
    res = client.get("/api/health")
    assert res.status_code == 503
    assert res.json() == {"status": "error", "failed": ["worker"]}


@pytest.mark.django_db
def test_heartbeat_expires(heartbeat_key):
    tasks.heartbeat()
    with health._redis() as r:
        assert 0 < r.ttl(heartbeat_key) <= 90


@pytest.mark.django_db
def test_health_503_when_redis_down(client, settings, heartbeat_key):
    tasks.heartbeat()
    settings.REDIS_URL = DEAD_REDIS
    res = client.get("/api/health")
    assert res.status_code == 503
    # redis가 죽으면 생존 신호도 확인할 수 없다
    assert res.json() == {"status": "error", "failed": ["redis", "worker"]}


@pytest.mark.django_db
def test_health_503_when_db_down(client, heartbeat_key, db_down):
    tasks.heartbeat()
    res = client.get("/api/health")
    assert res.status_code == 503
    assert res.json() == {"status": "error", "failed": ["db"]}


@pytest.mark.django_db
def test_ready_ignores_worker_heartbeat(client, heartbeat_key):
    """compose healthcheck·배포 스모크가 보는 것: 워커가 죽어도 api는 롤링에서 빠지지 않는다."""
    res = client.get("/api/health?scope=ready")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


@pytest.mark.django_db
def test_ready_503_when_db_or_redis_down(client, settings, db_down):
    settings.REDIS_URL = DEAD_REDIS
    res = client.get("/api/health?scope=ready")
    assert res.status_code == 503
    assert res.json() == {"status": "error", "failed": ["db", "redis"]}


def test_worker_container_check_follows_heartbeat(heartbeat_key):
    assert health.worker_alive() is False
    tasks.heartbeat()
    assert health.worker_alive() is True


def test_beat_schedules_heartbeat_every_15s():
    from config.celery import app

    entry = app.conf.beat_schedule["heartbeat"]
    assert entry["task"] == "daypage.tasks.heartbeat"
    assert entry["schedule"] == 15.0
    assert tasks.heartbeat.ignore_result is True


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


def test_client_config_hands_out_release(client, settings):
    """프론트 이벤트도 백엔드와 같은 release(배포 sha)로 묶이게 내려준다."""
    settings.SENTRY_RELEASE = "0123456789abcdef0123456789abcdef01234567"
    assert client.get("/api/client-config").json()["release"] == "0123456789abcdef0123456789abcdef01234567"
    settings.SENTRY_RELEASE = ""
    assert client.get("/api/client-config").json()["release"] is None
