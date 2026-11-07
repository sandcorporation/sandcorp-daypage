#!/usr/bin/env bash
# deploy/deploy.sh 를 가짜 docker(deploy/testdata/fake-docker)로 돌려 무중단 교체와 자동 롤백을 확인한다.
#   bash deploy/deploy_test.sh
# Jenkins·운영 없이 돈다(도커도 필요 없다). scripts/ci/check.sh 가 PR 검사·배포 전 검사에서 부른다.
#
# 자동 롤백은 공용 라이브러리 sandcorpDeploy(deployScript)가 한다: 이 스크립트가 0이 아니게 끝나면 직전 성공 sha 이미지로
# 같은 스크립트를 SANDCORP_ROLLBACK=1 로 한 번 더 부른다. 여기서는 그 두 번 부르기를 그대로 흉내 낸다(deploy_like_library).
# 가짜 docker 는 backend 를 다시 만드는 순간 다른 backend 가 healthy 가 아니면 OUTAGE 를 적는다 — 그게 없어야 무중단이다.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
script="$root/deploy/deploy.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/daypage-deploy-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
cp "$root/deploy/testdata/fake-docker" "$work/bin/docker"
chmod +x "$work/bin/docker"
OLD_B=ghcr.io/x/daypage-backend:old
OLD_W=ghcr.io/x/daypage-web-dist:old
NEW_B=ghcr.io/x/daypage-backend:new
NEW_W=ghcr.io/x/daypage-web-dist:new
# sandcorpDeploy가 배포 스크립트에 주는 SANDCORP_IMAGE_SHA(새 배포·롤백). compose가 SENTRY_RELEASE로 넘긴다.
NEW_SHA=1111111111111111111111111111111111111111
OLD_SHA=2222222222222222222222222222222222222222
pass=0
fail=0

# 새 워크스페이스: 운영이 옛 이미지로 healthy 하게 떠 있는 상태에서 시작한다.
fresh() {
  WS="$work/$1"
  mkdir -p "$WS/state"
  printf 'DJANGO_ALLOWED_HOSTS=daypage.example\n' > "$WS/.env"
  : > "$WS/log"
  local s
  for s in backend backend2 worker beat; do
    printf '%s' "$OLD_B" > "$WS/state/$s.image"
    printf healthy > "$WS/state/$s.status"
  done
  for s in web postgres redis; do
    printf '%s' "$([ "$s" = web ] && echo caddy || echo "$s-fixed")" > "$WS/state/$s.image"
    printf healthy > "$WS/state/$s.status"
  done
  printf '%s' "$OLD_W" > "$WS/state/static.image"
}

# once <backend 이미지> <web-dist 이미지> <SANDCORP_ROLLBACK> [VAR=값 ...] — deploy.sh 한 번
once() {
  local b=$1 w=$2 rb=$3
  shift 3
  echo "---- deploy.sh SANDCORP_ROLLBACK=$rb ($b)" >> "$WS/log"
  (
    cd "$WS" || exit 99
    env PATH="$work/bin:$PATH" FAKE_LOG="$WS/log" FAKE_STATE="$WS/state" \
      COMPOSE_PROJECT_NAME=daypage COMPOSE_FILE=docker-compose.prod.yml:docker-compose.oracle.yml \
      DAYPAGE_BACKEND_IMAGE="$b" DAYPAGE_WEB_DIST_IMAGE="$w" SANDCORP_ROLLBACK="$rb" \
      DEPLOY_SLEEP=0 DEPLOY_HEALTHY_TRIES=3 DEPLOY_HEALTH_TRIES=2 \
      "$@" bash "$script" >> "$WS/out" 2>&1
  )
}

# sandcorpDeploy.deployHere 와 같은 순서: 새 이미지로 → 실패하면 직전 이미지로 SANDCORP_ROLLBACK=1. 종료: 0 · 3(롤백 성공) · 4(롤백 실패)
deploy_like_library() {
  once "$NEW_B" "$NEW_W" 0 SANDCORP_IMAGE_SHA="$NEW_SHA" "$@" && return 0
  if once "$OLD_B" "$OLD_W" 1 SANDCORP_IMAGE_SHA="$OLD_SHA" "$@"; then return 3; fi
  return 4
}

check() {
  local what=$1
  shift
  if "$@"; then
    pass=$((pass + 1))
  else
    echo "FAIL [$CASE] $what"
    sed 's/^/    /' "$WS/log" | tail -n 40
    tail -n 15 "$WS/out" | sed 's/^/    out: /'
    fail=$((fail + 1))
  fi
}
img() { cat "$WS/state/$1.image"; }
no_outage() { ! grep -q OUTAGE "$WS/log"; }
# 롤백 호출(두 번째 ---- 줄) 뒤에 migrate 가 없다
no_migrate_in_rollback() { ! sed -n '/SANDCORP_ROLLBACK=1/,$p' "$WS/log" | grep -q MIGRATE; }
# backend 를 하나씩: backend 를 다시 만든 뒤 healthy 를 확인(inspect cid-backend)하고 나서야 backend2 를 다시 만든다
one_by_one() {
  awk '
    /SANDCORP_ROLLBACK=/ { phase++ }
    /^RECREATE backend / { b[phase] = NR }
    /inspect .*cid-backend$/ { if (b[phase] && !ok[phase]) ok[phase] = NR }
    /^RECREATE backend2 / { if (!b[phase] || !ok[phase] || ok[phase] > NR) bad = 1 }
    END { exit bad }
  ' "$WS/log"
}

CASE="성공"
fresh success
deploy_like_library
rc=$?
check "종료 0 (실제 $rc)" test "$rc" = 0
check "backend·backend2·worker·beat 새 이미지" test "$(img backend)$(img backend2)$(img worker)$(img beat)" = "$NEW_B$NEW_B$NEW_B$NEW_B"
check "정적 파일 새 이미지" test "$(img static)" = "$NEW_W"
check "migrate 한 번, backend 교체보다 먼저" awk '/MIGRATE/{m=NR} /^RECREATE backend /{r=NR} END{exit !(m && r && m < r)}' "$WS/log"
check "Caddy 는 다시 만들지 않는다(reload 만)" bash -c "! grep -q '^RECREATE web ' '$WS/log' && grep -q 'caddy reload' '$WS/log'"
check "무중단(OUTAGE 없음)" no_outage
check "backend 하나씩" one_by_one
check "compose 가 배포 sha(SANDCORP_IMAGE_SHA)를 받는다" bash -c "! grep '^RECREATE ' '$WS/log' | grep -v 'sha=$NEW_SHA\$'"
check "docker-compose.prod.yml 이 그 sha 를 SENTRY_RELEASE 로 넘긴다" grep -q 'SENTRY_RELEASE: \${SANDCORP_IMAGE_SHA:-}' "$root/docker-compose.prod.yml"

CASE="SANDCORP_ROLLBACK=1 은 migrate 를 건너뛴다"
fresh rb-only
once "$OLD_B" "$OLD_W" 1
rc=$?
check "종료 0 (실제 $rc)" test "$rc" = 0
check "migrate 없음" bash -c "! grep -q MIGRATE '$WS/log'"
check "건너뜀이 출력에 남는다" grep -q 'migrate 건너뜀' "$WS/out"

CASE="새 backend 가 healthy 가 안 됨 → 자동 롤백"
fresh unhealthy
deploy_like_library FAKE_UNHEALTHY=":new"
rc=$?
check "롤백 성공 종료 3 (실제 $rc)" test "$rc" = 3
check "backend·backend2 옛 이미지" test "$(img backend)$(img backend2)" = "$OLD_B$OLD_B"
check "backend2 는 새 이미지로 바뀐 적이 없다(앞 것이 healthy 가 아니면 멈춘다)" bash -c "! grep -q '^RECREATE backend2 $NEW_B' '$WS/log'"
check "무중단(OUTAGE 없음) — 실패한 동안 backend2 가 받는다" no_outage
check "롤백은 migrate 를 건너뛴다" no_migrate_in_rollback
check "backend 하나씩(롤백 포함)" one_by_one

CASE="교체 뒤 헬스 실패 → 자동 롤백(두 backend 모두 되돌림)"
fresh badhealth
deploy_like_library FAKE_BAD_HEALTH=":new"
rc=$?
check "롤백 성공 종료 3 (실제 $rc)" test "$rc" = 3
check "backend·backend2·worker·beat 옛 이미지" test "$(img backend)$(img backend2)$(img worker)$(img beat)" = "$OLD_B$OLD_B$OLD_B$OLD_B"
check "정적 파일도 옛 이미지" test "$(img static)" = "$OLD_W"
check "롤백은 직전 sha 로 다시 만든다(release 도 되돌아간다)" bash -c "sed -n '/SANDCORP_ROLLBACK=1/,\$p' '$WS/log' | grep '^RECREATE backend ' | grep -q 'sha=$OLD_SHA\$'"
check "롤백도 backend 를 하나씩 바꾼다" test "$(sed -n '/SANDCORP_ROLLBACK=1/,$p' "$WS/log" | grep -c '^RECREATE backend')" = 2
check "무중단(OUTAGE 없음)" no_outage
check "롤백은 migrate 를 건너뛴다" no_migrate_in_rollback
check "backend 하나씩(롤백 포함)" one_by_one

CASE="migrate 실패 → backend 는 그대로(롤백 호출은 아무것도 다시 만들지 않는다)"
fresh migratefail
deploy_like_library FAKE_MIGRATE_FAIL=1
rc=$?
check "종료 3 (실제 $rc)" test "$rc" = 3
check "backend 를 다시 만든 적 없다" bash -c "! grep -q '^RECREATE backend' '$WS/log'"
check "backend·backend2 옛 이미지" test "$(img backend)$(img backend2)" = "$OLD_B$OLD_B"

echo "deploy.sh 시험: 통과 $pass · 실패 $fail"
[ "$fail" = 0 ]
