#!/usr/bin/env bash
# 배포 전·PR 검사: 배포 스크립트 시험(무중단·자동 롤백) + 백엔드 ruff·pytest + 프론트·admin lint·typecheck·vitest.
# Jenkins `sandcorp-daypage`(공용 라이브러리 sandcorpDeploy의 「검사」)가 빌드 노드에서 이미지를 굽기 전에 부르고,
# 실패하면 이미지를 굽지도 배포하지도 않는다. PR 검사는 GitHub Actions(.github/workflows/pr-check.yml)가 같은 검사를 job으로 나눠 돈다.
# 노드에 uv·pnpm이 없어도 되고, 로컬에서도 그대로 돈다. 펜·터치 e2e(Playwright)는 돌리지 않는다.
#
#   bash scripts/ci/check.sh
#
# 시험 DB·Redis는 이 실행만의 컨테이너(postgres:17-alpine·redis:7-alpine)를 이 실행만의 네트워크에 띄운다 — 호스트 포트를
# 열지 않아 다른 작업(docker compose의 5432·6379 등)과 겹치지 않는다. 끝나면 컨테이너·네트워크·검사 이미지 태그를 지운다.
set -euo pipefail
cd "$(dirname "$0")/../.."

run_id="daypage-check-$(date +%s)-$$"
image="daypage-check:$run_id"
net="$run_id"
db="$run_id-db"
redis="$run_id-redis"

cleanup() {
  docker rm -f "$db" "$redis" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "== 배포 스크립트 시험 (가짜 docker)"
bash deploy/deploy_test.sh

echo "== 검사 이미지"
DOCKER_BUILDKIT=1 docker build -f scripts/ci/check.Dockerfile -t "$image" .

echo "== 시험 DB·Redis (네트워크 $net)"
docker network create "$net" >/dev/null
docker run -d --name "$db" --network "$net" --network-alias db \
  -e POSTGRES_DB=daypage -e POSTGRES_USER=daypage -e POSTGRES_PASSWORD=daypage postgres:17-alpine >/dev/null
docker run -d --name "$redis" --network "$net" --network-alias redis redis:7-alpine >/dev/null
ready=0
for _ in $(seq 1 60); do
  # pg_isready 는 초기화 중 임시 서버에도 답한다 — 실제로 질의가 되는지 본다.
  if docker exec "$db" psql -U daypage -h 127.0.0.1 -d daypage -c 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  echo "시험 DB가 뜨지 않았다" >&2
  docker logs --tail 40 "$db" >&2 || true
  exit 1
fi

echo "== 백엔드 ruff·pytest · 프론트 lint·typecheck·vitest · admin typecheck·vitest"
docker run --rm --network "$net" \
  -e POSTGRES_HOST=db -e POSTGRES_PORT=5432 -e POSTGRES_DB=daypage -e POSTGRES_USER=daypage -e POSTGRES_PASSWORD=daypage \
  -e REDIS_URL=redis://redis:6379/0 \
  -e DAYPAGE_TEST_CPU_LIMIT="${DAYPAGE_TEST_CPU_LIMIT:-1.0}" "$image" \
  sh -c 'set -e
    cd /app/backend && uv run ruff check && uv run pytest -q
    cd /app/frontend && pnpm lint && pnpm typecheck && pnpm test
    cd /app/admin && pnpm typecheck && pnpm test'
echo "== 검사 통과"
