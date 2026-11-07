#!/usr/bin/env bash
# 운영 건의함(daypage_suggestion)을 읽기 전용으로 살핀다. Orca 자동화(docs/agents/suggestion-automation.md)가 쓴다.
#
#   suggestions.sh check     새 건의(status=new, 아직 배정 안 됨)가 있으면 0, 없으면 1  ← Orca 자동화의 precheck
#   suggestions.sh list      새 건의를 JSON 한 줄씩 출력 {"id","at"(KST),"nickname","text","context"(보낼 때의 화면 상태)}
#   suggestions.sh take      list와 같되, 출력한 건의를 '배정됨'으로 기록한다(다음 check에서 빠진다)
#                            받은 건의는 forward가 성공할 때까지 '전달 대기'로 남는다. 전달 대기가 STALE초
#                            (기본 900)를 넘으면 check·list·take에 다시 나온다(받고 나서 실행이 죽어도 사라지지 않는다).
#   suggestions.sh forward ID 제목   표준 입력의 본문을 대장 메일함으로 보낸다. 「Sent msg_」가 안 나오면
#                            그 건의를 되돌리고(untake) 0이 아닌 코드로 끝난다. 성공하면 전달 대기에서 뺀다.
#   suggestions.sh untake ID…  배정 기록을 지운다(다음 check에서 다시 잡힌다)
#   suggestions.sh mark ID…  해당 id를 배정됨으로 기록만 한다(처음 설치할 때 지난 건의를 거르는 용도)
#   suggestions.sh status ID reviewing|done|declined [덧붙임]
#                            건의 상태를 바꾼다. 검토 중·반영함이 되면 디스코드 건의 채널에 알림이 간다.
#
# 운영 DB에 쓰는 것은 status 하나뿐이다(관리 명령 suggestion_status, 상태 칸만 바꾼다).
# 나머지는 읽기만 한다(SELECT). 배정 기록은 이 컴퓨터의 파일에 둔다.
set -euo pipefail

STATE="${DAYPAGE_SUGGESTION_STATE:-$HOME/.daypage/suggestions-dispatched}"
DB_HOST="${DAYPAGE_DB_SSH_HOST:-oracle}"
DB_CONTAINER="${DAYPAGE_DB_CONTAINER:-daypage-postgres-1}"
APP_CONTAINER="${DAYPAGE_APP_CONTAINER:-daypage-backend-1}"
PENDING="${DAYPAGE_SUGGESTION_PENDING:-$STATE.pending}"   # 한 줄에 "id 받은시각(epoch)"
STALE="${DAYPAGE_SUGGESTION_STALE:-900}"
RELAY_TO="${DAYPAGE_SUGGESTION_RELAY_TO:-run:run_e083f7b1d874}"   # 대장 회신 주소
RELAY_ENV="${DAYPAGE_SUGGESTION_RELAY_ENV:-windows}"            # 대장이 있는 Orca 환경

query_new() {
  # row_to_json으로 한 줄에 하나씩. 본문의 줄바꿈은 JSON 안에서 \n으로 남는다.
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$DB_HOST" \
    "docker exec $DB_CONTAINER psql -U daypage -d daypage -At -c \"
      SELECT row_to_json(r) FROM (
        SELECT s.id,
               to_char(s.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at,
               COALESCE(m.nickname, '') AS nickname,
               s.text,
               COALESCE(to_jsonb(s)->'context', '{}'::jsonb) AS context
        FROM daypage_suggestion s
        LEFT JOIN daypage_notemember m ON m.note_id = s.note_id AND m.user_id = s.user_id
        WHERE s.status = 'new' ORDER BY s.id
      ) r\""
}

id_of() { sed -E 's/^\{"id":([0-9]+).*/\1/'; }

prepare() { mkdir -p "$(dirname "$STATE")"; touch "$STATE" "$PENDING"; }

# 받고 나서 STALE초가 지나도록 전달되지 않은 id
stale_pending() { awk -v now="$(date +%s)" -v stale="$STALE" 'now - $2 >= stale { print $1 }' "$PENDING"; }

drop_lines() {  # drop_lines 파일 id… — 그 id로 시작하는 줄을 지운다
  local file="$1"; shift
  local tmp; tmp="$(mktemp)"
  awk -v ids=" $* " 'index(ids, " " $1 " ") == 0' "$file" > "$tmp"
  mv "$tmp" "$file"
}

undispatched() {
  prepare
  local stale; stale=" $(stale_pending | tr '\n' ' ') "
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    id="$(printf '%s' "$line" | id_of)"
    if ! grep -qx "$id" "$STATE" || [[ "$stale" == *" $id "* ]]; then printf '%s\n' "$line"; fi
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
    now="$(date +%s)"
    ids="$(printf '%s\n' "$out" | id_of)"
    # shellcheck disable=SC2086
    drop_lines "$STATE" $ids
    # shellcheck disable=SC2086
    drop_lines "$PENDING" $ids
    printf '%s\n' "$ids" >> "$STATE"
    printf '%s\n' "$ids" | sed "s/\$/ $now/" >> "$PENDING"
    ;;
  forward)
    id="${2:-}"; subject="${3:-}"
    [[ "$id" =~ ^[0-9]+$ ]] && [ -n "$subject" ] || { echo "건의 id와 제목이 필요해요" >&2; exit 2; }
    prepare
    body="$(cat)"
    out="$(orca orchestration send --environment "$RELAY_ENV" --to "$RELAY_TO" --type status \
             --subject "$subject" --body "$body" 2>&1 || true)"
    printf '%s\n' "$out"
    if printf '%s' "$out" | grep -q 'Sent msg_'; then
      drop_lines "$PENDING" "$id"
    else
      drop_lines "$STATE" "$id"; drop_lines "$PENDING" "$id"
      echo "대장에게 못 보내 건의 #$id 를 되돌렸어요(다음 check에서 다시 잡힘)" >&2
      exit 1
    fi
    ;;
  untake)
    shift
    prepare
    drop_lines "$STATE" "$@"; drop_lines "$PENDING" "$@"
    ;;
  mark)
    shift
    mkdir -p "$(dirname "$STATE")"
    for id in "$@"; do printf '%s\n' "$id" >> "$STATE"; done
    ;;
  status)
    id="${2:-}"; to="${3:-}"; note="${4:-}"
    [[ "$id" =~ ^[0-9]+$ ]] || { echo "건의 id가 필요해요" >&2; exit 2; }
    case "$to" in reviewing|done|declined) ;; *) echo "상태는 reviewing·done·declined 가운데 하나예요" >&2; exit 2 ;; esac
    # 덧붙임은 표준 입력으로 넘겨 따옴표·한글이 ssh를 거치며 깨지지 않게 한다.
    printf '%s' "$note" | ssh -o BatchMode=yes -o ConnectTimeout=15 "$DB_HOST" \
      "docker exec -i $APP_CONTAINER python manage.py suggestion_status $id $to --note -"
    ;;
  *)
    sed -n '2,18p' "$0" >&2
    exit 2
    ;;
esac
