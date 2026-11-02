#!/usr/bin/env bash
# Jenkins(oracle 에이전트)에서 부른다. 워크스페이스의 .env를 쓴다(저장소에는 없음).
# Jenkinsfile의 공용 라이브러리 sandcorpDeploy가 `deployScript`로 부른다: 이미지 변수(DAYPAGE_*_IMAGE)와
# COMPOSE_PROJECT_NAME·COMPOSE_FILE·SANDCORP_ROLLBACK=0을 주고, 이 스크립트가 0이 아니게 끝나면 직전 성공 sha 이미지로
# 같은 스크립트를 SANDCORP_ROLLBACK=1로 한 번 더 부른다(자동 롤백). 그때는 migrate를 건너뛰고 같은 무중단 순서로 되돌린다.
# 시험: bash deploy/deploy_test.sh(가짜 docker, scripts/ci/check.sh가 PR·배포 전에 돌린다).
# 시험용 조절: DEPLOY_SLEEP(대기 간격 초), DEPLOY_HEALTHY_TRIES(기본 90), DEPLOY_HEALTH_TRIES(기본 40).
#
# 무중단 배포: 한꺼번에 내리지 않고 하나씩 바꾼다.
#   1) 이미지 준비(Jenkins: ghcr에서 pull만, oracle에서 굽지 않는다 #99 / 변수가 없으면 로컬 빌드) → 2) migrate(옛 백엔드가 계속 받는 중) → 3) backend, backend2를 하나씩 교체
#   (다음 것을 바꾸기 전에 앞의 것이 헬스를 통과할 때까지 기다린다. 그동안 Caddy가 다른 쪽으로 보낸다)
#   → 4) 정적 파일을 볼륨에 넣고 index.html만 바꿔 끼움 → 5) Caddy 설정 reload(컨테이너는 그대로)
#   → 6) worker·beat 교체(사용자 요청과 무관)
# migrate는 옛 코드와 새 코드가 같은 DB에서 잠깐 함께 돈다는 전제다. 열을 지우거나 이름을 바꾸는
# 마이그레이션은 두 번의 배포로 나눈다(먼저 안 쓰게 하고, 다음 배포에서 지운다).
set -euo pipefail

if [ ! -f .env ]; then
  echo "워크스페이스에 .env가 없다. .env.example의 운영 항목으로 만들어 두어야 한다." >&2
  exit 1
fi

compose() { docker compose "$@"; }

# 서비스 컨테이너가 healthy가 될 때까지 기다린다.
wait_healthy() {
  local svc=$1
  for i in $(seq 1 "${DEPLOY_HEALTHY_TRIES:-90}"); do
    local id status
    id=$(compose ps -q "$svc")
    status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)
    if [ "$status" = "healthy" ]; then
      echo "$svc healthy (${i}회째)"
      return 0
    fi
    sleep "${DEPLOY_SLEEP:-2}"
  done
  echo "$svc가 healthy가 되지 않았다" >&2
  compose logs --tail 80 "$svc" >&2
  return 1
}

if [ -n "${DAYPAGE_BACKEND_IMAGE:-}" ] && [ -n "${DAYPAGE_WEB_DIST_IMAGE:-}" ]; then
  # ghcr 읽기 로그인은 oracle 호스트의 docker 설정에 있다. 빌드하지 않는다.
  echo "== 이미지 pull ($DAYPAGE_BACKEND_IMAGE, $DAYPAGE_WEB_DIST_IMAGE)"
  docker pull "$DAYPAGE_BACKEND_IMAGE"
  docker pull "$DAYPAGE_WEB_DIST_IMAGE"
  BUILD_FLAG=--no-build
else
  echo "== 이미지 빌드"
  compose build backend
  compose --profile deploy build web-dist
  BUILD_FLAG=
fi

echo "== DB·Redis (이미 떠 있으면 그대로)"
compose up -d --no-recreate postgres redis
wait_healthy postgres

if [ "${SANDCORP_ROLLBACK:-0}" = 1 ]; then
  # 자동 롤백: migrate는 되돌리지 않는다(옛 코드가 새 스키마와 호환되게 짜는 규칙, PR의 파괴적 migrate 검사).
  echo "== migrate 건너뜀 (자동 롤백 — 직전 이미지로 되돌리는 중)"
else
  echo "== migrate (옛 백엔드는 계속 요청을 받는다)"
  compose run --rm --no-deps backend python manage.py migrate --noinput
fi

echo "== 백엔드 하나씩 교체"
for svc in backend backend2; do
  compose up -d --no-deps $BUILD_FLAG "$svc"
  wait_healthy "$svc"
done

echo "== 정적 파일 반영"
compose --profile deploy run --rm --no-deps web-dist

echo "== Caddy (떠 있으면 컨테이너는 그대로 두고 설정만 다시 읽는다)"
compose up -d --no-deps web
compose exec -T web caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

echo "== worker·beat"
compose up -d --no-deps $BUILD_FLAG worker beat

# Django는 ALLOWED_HOSTS에 없는 Host를 거부하므로 운영 도메인을 Host로 보낸다.
HOST=$(grep -E '^DJANGO_ALLOWED_HOSTS=' .env | cut -d= -f2 | cut -d, -f1 || true)
HOST=${HOST:-localhost}

echo "== 헬스 확인 (Host: $HOST)"
for i in $(seq 1 "${DEPLOY_HEALTH_TRIES:-40}"); do
  if compose exec -T web wget -qO- --header "Host: $HOST" http://127.0.0.1/api/health 2>/dev/null | grep -q '"ok"'; then
    echo "헬스 OK (${i}회째)"
    compose ps
    if [ -n "${DAYPAGE_BACKEND_IMAGE:-}" ]; then
      # pull 한 옛 sha 이미지는 dangling 이 아니라 prune 에 안 걸린다 — 이미지마다 최신 3개만 남긴다(롤백은 다시 pull).
      for img in "${DAYPAGE_BACKEND_IMAGE%:*}" "${DAYPAGE_WEB_DIST_IMAGE%:*}"; do
        docker image ls --format '{{.Repository}}:{{.Tag}}' "$img" | tail -n +4 | xargs -r docker rmi >/dev/null 2>&1 || true
      done
    fi
    exit 0
  fi
  sleep "${DEPLOY_SLEEP:-3}"
done

echo "헬스 확인 실패" >&2
compose ps >&2
compose logs --tail 80 backend backend2 web >&2
exit 1
