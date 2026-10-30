#!/usr/bin/env bash
# linux/arm64 배포 이미지 둘(backend, web-dist)을 굽고 ghcr 에 올린다(#99). Jenkinsfile 의 「이미지 빌드」 단계가 macos 또는 sub 에서 부른다.
#
#   scripts/ci/build-image.sh <macos|sub>
#
# 환경변수: GHCR_TOKEN(ghcr 쓰기 토큰, Jenkins `ghcr-push-token`), DAYPAGE_IMAGE_PREFIX(기본 ghcr.io/sandcorporation/daypage),
#           DAYPAGE_BUILDER(buildx 빌더 이름)
# 결과: `<prefix>-backend:<커밋 sha 40자>`, `<prefix>-web-dist:<커밋 sha 40자>`. 빌드 캐시는 각 `<이미지>-buildcache:arm64`(레지스트리).
# bash 3.2(macos 노드)에서도 돈다. 노드의 docker 설정은 건드리지 않고 임시 DOCKER_CONFIG 에만 토큰을 적는다.
# 비공개 의존성이 없어 ssh 마운트는 쓰지 않는다. 프론트의 메트릭 스니펫 주소는 빌드가 아니라 배포 때 넣는다(deploy/publish-static.sh).
set -euo pipefail

where="${1:-}"
case "$where" in macos|sub) ;; *) echo "쓰는 법: $0 <macos|sub>" >&2; exit 2 ;; esac

cd "$(dirname "$0")/../.."
prefix="${DAYPAGE_IMAGE_PREFIX:-ghcr.io/sandcorporation/daypage}"
builder="${DAYPAGE_BUILDER:-daypage-images}"
sha="$(git -c safe.directory="$PWD" rev-parse HEAD)"
start="$(date +%s)"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/daypage-docker.XXXXXX")"
cleanup() {
  rm -rf "$tmp"
  if [ -n "${SSH_AGENT_PID:-}" ]; then ssh-agent -k >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! docker buildx version >/dev/null 2>&1; then
  echo "이 노드의 docker CLI 에 buildx 가 없다" >&2
  exit 1
fi

if [ -n "${GHCR_TOKEN:-}" ]; then
  orig="${DOCKER_CONFIG:-$HOME/.docker}"
  mkdir -p "$orig/buildx"
  for d in cli-plugins buildx contexts; do
    if [ -e "$orig/$d" ]; then ln -s "$orig/$d" "$tmp/$d"; fi
  done
  # auths 에 직접 적는다 — `docker login` 은 키체인(macos)·pass 를 찾다 잠겨서 실패한다.
  python3 - "$orig/config.json" "$tmp/config.json" <<'PY'
import base64, json, os, sys
src, dst = sys.argv[1:3]
try:
    with open(src) as f:
        cfg = json.load(f)
except (OSError, ValueError):
    cfg = {}
for key in ("auths", "credsStore", "credHelpers"):
    cfg.pop(key, None)
tok = os.environ["GHCR_TOKEN"].strip()
cfg["auths"] = {"ghcr.io": {"auth": base64.b64encode(f"daypage-ci:{tok}".encode()).decode()}}
fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(cfg, f)
PY
  export DOCKER_CONFIG="$tmp"
else
  echo "GHCR_TOKEN 이 없다 — 이 노드의 docker 로그인을 그대로 쓴다"
fi

if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  echo "빌더 $builder 를 만든다(docker-container)"
  docker buildx create --name "$builder" --driver docker-container >/dev/null
fi
docker buildx inspect --bootstrap "$builder" >/dev/null

# 이름 | 컨텍스트 | Dockerfile
build_one() {
  local name="$1" context="$2" dockerfile="$3"
  local repo="$prefix-$name"
  local cache="$repo-buildcache:arm64"
  echo "빌드 노드 $where · linux/arm64 · $repo:$sha"
  docker buildx build --builder "$builder" --platform linux/arm64 --provenance=false --push \
    --tag "$repo:$sha" \
    --label "org.opencontainers.image.source=https://github.com/sandcorporation/daypasge" \
    --label "org.opencontainers.image.revision=$sha" \
    --cache-from "type=registry,ref=$cache" \
    --cache-to "type=registry,ref=$cache,mode=max" \
    --file "$dockerfile" \
    "$context"
}

build_one backend backend backend/Dockerfile
build_one web-dist . deploy/web.Dockerfile
echo "이미지 빌드·push 완료 ($where): $(( $(date +%s) - start ))초"
