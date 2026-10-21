#!/usr/bin/env bash
# 운영 건의함(daypage_suggestion)을 읽기 전용으로 살핀다. Orca 자동화(docs/agents/suggestion-automation.md)가 쓴다.
#
#   suggestions.sh check     새 건의(status=new, 아직 배정 안 됨)가 있으면 0, 없으면 1  ← Orca 자동화의 precheck
#   suggestions.sh list      새 건의를 JSON 한 줄씩 출력 {"id","at"(KST),"nickname","text"}
#   suggestions.sh take      list와 같되, 출력한 건의를 '배정됨'으로 기록한다(다음 check에서 빠진다)
#   suggestions.sh mark ID…  해당 id를 배정됨으로 기록만 한다(처음 설치할 때 지난 건의를 거르는 용도)
#
# 운영 DB는 절대 쓰지 않는다(SELECT만). 배정 기록은 이 컴퓨터의 파일에 둔다.
set -euo pipefail

STATE="${DAYPAGE_SUGGESTION_STATE:-$HOME/.daypage/suggestions-dispatched}"
DB_HOST="${DAYPAGE_DB_SSH_HOST:-oracle}"
DB_CONTAINER="${DAYPAGE_DB_CONTAINER:-daypage-postgres-1}"

query_new() {
  # row_to_json으로 한 줄에 하나씩. 본문의 줄바꿈은 JSON 안에서 \n으로 남는다.
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$DB_HOST" \
    "docker exec $DB_CONTAINER psql -U daypage -d daypage -At -c \"
      SELECT row_to_json(r) FROM (
        SELECT s.id,
               to_char(s.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at,
               COALESCE(m.nickname, '') AS nickname,
               s.text
        FROM daypage_suggestion s
        LEFT JOIN daypage_notemember m ON m.note_id = s.note_id AND m.user_id = s.user_id
        WHERE s.status = 'new' ORDER BY s.id
      ) r\""
}

id_of() { sed -E 's/^\{"id":([0-9]+).*/\1/'; }

undispatched() {
  mkdir -p "$(dirname "$STATE")"
  touch "$STATE"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    id="$(printf '%s' "$line" | id_of)"
    grep -qx "$id" "$STATE" || printf '%s\n' "$line"
  done < <(query_new)
}

case "${1:-}" in
  check)
    [ -n "$(undispatched)" ]
    ;;
  list)
    undispatched
    ;;
  take)
    out="$(undispatched)"
    [ -n "$out" ] || exit 0
    printf '%s\n' "$out"
    printf '%s\n' "$out" | id_of >> "$STATE"
    ;;
  mark)
    shift
    mkdir -p "$(dirname "$STATE")"
    for id in "$@"; do printf '%s\n' "$id" >> "$STATE"; done
    ;;
  *)
    sed -n '2,8p' "$0" >&2
    exit 2
    ;;
esac
