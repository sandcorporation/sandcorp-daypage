#!/usr/bin/env bash
# e2e용 백엔드: 따로 이름 붙인 시험 DB를 만들고 마이그레이션한 뒤 개발 로그인(DJANGO_DEV_LOGIN)으로 띄운다.
# 운영 DB·공유 DB를 쓰지 않는다: E2E_POSTGRES_DB(기본 daypage_e2e)와 Redis 9번 DB만 쓴다.
set -euo pipefail
cd "$(dirname "$0")/../../backend"
export POSTGRES_DB="${E2E_POSTGRES_DB:-daypage_e2e}"
export REDIS_URL="${E2E_REDIS_URL:-redis://127.0.0.1:6379/9}"
export DJANGO_DEV_LOGIN=1
export DJANGO_DEBUG=1
export DJANGO_CSRF_TRUSTED_ORIGINS="http://127.0.0.1:${E2E_FRONT_PORT:-5183},http://localhost:${E2E_FRONT_PORT:-5183}"
uv run python - <<'PY'
import os
import psycopg
from psycopg import sql

name = os.environ["POSTGRES_DB"]
with psycopg.connect(
    dbname="postgres",
    user=os.environ.get("POSTGRES_USER", "daypage"),
    password=os.environ.get("POSTGRES_PASSWORD", "daypage"),
    host=os.environ.get("POSTGRES_HOST", "127.0.0.1"),
    port=os.environ.get("POSTGRES_PORT", "5432"),
    autocommit=True,
) as c:
    if not c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
        c.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
PY
uv run python manage.py migrate --noinput >/dev/null
exec uv run uvicorn config.asgi:application --port "${E2E_BACKEND_PORT:-8010}"
