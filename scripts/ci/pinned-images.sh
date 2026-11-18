#!/usr/bin/env bash
# 외부 이미지가 digest로 고정됐는지 본다(#132). 떠다니는 태그는 상류가 옮기면 상태 있는 컨테이너가 재생성된다.
#   bash scripts/ci/pinned-images.sh [저장소 루트]
# 보는 곳: 루트의 compose 파일(docker-compose*.yml·compose*.yml)과 .github/workflows/*.yml 의 `image:`,
#          저장소 안의 Dockerfile(*Dockerfile*) `FROM`.
# 예외: 환경변수 이미지(`${DAYPAGE_…}` 등 `$`가 든 값), 같은 Dockerfile 앞에서 `AS`로 이름 붙인 단계, scratch.
# 고정 모양: `이름:버전@sha256:<64 hex>`.
set -euo pipefail
root="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$root"

bad=0
pinned() { [[ "$1" =~ @sha256:[0-9a-f]{64}$ ]]; }
report() { echo "고정 안 됨: $1:$2: $3"; bad=$((bad + 1)); }

shopt -s nullglob
for f in docker-compose*.yml docker-compose*.yaml compose*.yml compose*.yaml .github/workflows/*.yml .github/workflows/*.yaml; do
  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    [[ "$line" =~ ^[[:space:]]*(-[[:space:]]+)?image:[[:space:]]*([^#]*) ]] || continue
    v="${BASH_REMATCH[2]}"
    v="${v%"${v##*[![:space:]]}"}"   # 뒤 공백
    v="${v#[\"\']}"; v="${v%[\"\']}"
    [ -z "$v" ] && continue          # `image:` 키만 있는 줄(잡 이름 등)
    [[ "$v" == *'$'* ]] && continue  # 환경변수 이미지
    pinned "$v" || report "$f" "$n" "$v"
  done < "$f"
done

while IFS= read -r -d '' f; do
  n=0; stages=" "
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    shopt -s nocasematch
    if [[ "$line" =~ ^[[:space:]]*FROM[[:space:]]+(--[^[:space:]]+[[:space:]]+)*([^[:space:]]+)([[:space:]]+AS[[:space:]]+([^[:space:]]+))? ]]; then
      img="${BASH_REMATCH[2]}"; stage="${BASH_REMATCH[4]:-}"
      lower="$(tr '[:upper:]' '[:lower:]' <<<"$img")"
      if [ "$lower" != scratch ] && [[ "$stages" != *" $lower "* ]]; then
        pinned "$img" || report "${f#./}" "$n" "FROM $img"
      fi
      [ -n "$stage" ] && stages+="$(tr '[:upper:]' '[:lower:]' <<<"$stage") "
    fi
    shopt -u nocasematch
  done < "$f"
done < <(find . \( -name node_modules -o -name .git -o -name .venv \) -prune -o -type f -name '*Dockerfile*' -print0)

if [ "$bad" != 0 ]; then
  echo "digest로 고정하지 않은 이미지 $bad 개 — '이름:버전@sha256:…'로 적는다(docker buildx imagetools inspect <태그>)."
  exit 1
fi
echo "이미지 고정 검사: 통과"
