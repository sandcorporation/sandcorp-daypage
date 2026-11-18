#!/usr/bin/env bash
# scripts/ci/pinned-images.sh 시험 — 임시 저장소 모양에 파일을 놓고 종료코드·출력을 본다.
#   bash scripts/ci/pinned-images_test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/pinned-images.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
D="sha256:$(printf 'a%.0s' {1..64})"

pass=0 fail=0
# 이름, 기대 종료코드, 출력에 있어야 할 말, 출력에 없어야 할 말(없으면 빈 값), 파일 경로=내용 ...
check() {
  local name="$1" want_rc="$2" want_out="$3" not_out="$4"; shift 4
  local dir="$tmp/$pass-$fail" out rc=0
  mkdir -p "$dir"
  for kv in "$@"; do mkdir -p "$dir/$(dirname "${kv%%=*}")"; printf '%s\n' "${kv#*=}" > "$dir/${kv%%=*}"; done
  out="$(bash "$script" "$dir" 2>&1)" || rc=$?
  if [ "$rc" = "$want_rc" ] && grep -qF -- "$want_out" <<<"$out" && { [ -z "$not_out" ] || ! grep -qF -- "$not_out" <<<"$out"; }; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "실패: $name (rc=$rc 기대 $want_rc)"; printf '  | %s\n' "$out"
  fi
}

check '고정된 compose·FROM 은 통과' 0 '통과' '' \
  "docker-compose.prod.yml=services:
  db:
    image: postgres:17.11-alpine@$D
  web:
    image: \"caddy:2@$D\"
  backend:
    image: \${DAYPAGE_BACKEND_IMAGE:-daypage-backend:latest}" \
  "backend/Dockerfile=FROM --platform=\$BUILDPLATFORM python:3.14.10-slim@$D AS base
FROM base
FROM scratch
COPY --from=base /a /a"
check 'compose 떠다니는 태그는 실패' 1 'docker-compose.yml:3: redis:7-alpine' '' \
  "docker-compose.yml=services:
  redis:
    image: redis:7-alpine"
check '워크플로 service 이미지도 본다' 1 '.github/workflows/pr-check.yml:5: postgres:17-alpine' '' \
  ".github/workflows/pr-check.yml=jobs:
  image:
    services:
      db:
        image: postgres:17-alpine
      redis:
        image: redis:7.4.9-alpine@$D"
check 'Dockerfile 떠다니는 FROM 은 실패' 1 'deploy/web.Dockerfile:2: FROM alpine:3.22' 'node:22' \
  "deploy/web.Dockerfile=FROM node:22.23.5-alpine@$D AS build
FROM alpine:3.22
COPY --from=build /x /x"
check '단계 이름은 앞에서 정의된 것만 예외' 1 'FROM build' '' \
  "Dockerfile=FROM build
FROM alpine@$D AS build"
check '태그 없는 digest 모양 오류(짧은 hex)' 1 'redis@sha256:abc' '' \
  "compose.yaml=services:
  r:
    image: redis@sha256:abc"
check 'node_modules 안 Dockerfile 은 보지 않는다' 0 '통과' '' \
  "frontend/node_modules/x/Dockerfile=FROM node:latest"
check '이미지 없는 저장소는 통과' 0 '통과' '' "README=x"
out="$(bash "$script" 2>&1)" && pass=$((pass + 1)) || { fail=$((fail + 1)); echo "실패: 실제 저장소"; printf '  | %s\n' "$out"; }

echo "pinned-images.sh 시험: 통과 $pass, 실패 $fail"
[ "$fail" = 0 ]
