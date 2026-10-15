#!/usr/bin/env bash
# Jenkins(oracle 에이전트)에서 부른다. 워크스페이스의 .env를 쓴다(저장소에는 없음).
set -euo pipefail

if [ ! -f .env ]; then
  echo "워크스페이스에 .env가 없다. .env.example의 운영 항목으로 만들어 두어야 한다." >&2
  exit 1
fi

compose() { docker compose "$@"; }

echo "== 이미지 빌드"
compose build backend web

echo "== 기동(backend가 시작하며 migrate)"
compose up -d --remove-orphans

# Django는 ALLOWED_HOSTS에 없는 Host를 거부하므로 운영 도메인을 Host로 보낸다.
HOST=$(grep -E '^DJANGO_ALLOWED_HOSTS=' .env | cut -d= -f2 | cut -d, -f1)
HOST=${HOST:-localhost}

echo "== 헬스 확인 (Host: $HOST)"
for i in $(seq 1 40); do
  if compose exec -T web wget -qO- --header "Host: $HOST" http://127.0.0.1/api/health 2>/dev/null | grep -q '"ok"'; then
    echo "헬스 OK (${i}회째)"
    compose ps
    exit 0
  fi
  sleep 3
done

echo "헬스 확인 실패" >&2
compose ps >&2
compose logs --tail 80 backend backend2 web >&2
exit 1
