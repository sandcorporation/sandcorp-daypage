# 건의함 자동 처리 (work의 Orca 자동화, 대장 경유)

운영 건의함(`daypage_suggestion`)에 새 건의가 들어오면 work의 Orca가 워커를 띄운다. 워커는 **코드를 고치지 않는다.** 건의를 받아(`take`) 원문·닉네임·context·분류(버그/기능/중복/버릴 것)·추정 영향 범위를 대장 메일함(`run:run_e083f7b1d874`, `--type status`, 제목 `[건의] daypage …`)으로 보내고 끝난다. 처리(구현·답변·상태 바꾸기)는 대장이 daypage 조율자에게 터미널로 지시한다(2026-11-07 대표 결정. 그 전에는 워커가 실행마다 새 worktree에서 구현해 검토 대기로 올렸다).

## 구성

| 것 | 어디 |
|---|---|
| 건의 조회·상태 스크립트 | `scripts/suggestions.sh` (조회는 읽기 전용 SELECT, ssh `oracle` → `daypage-postgres-1`. `status`만 `daypage-backend-1`의 관리 명령으로 상태 칸을 바꾼다) |
| 디스코드 알림 | 새 건의·검토 중·반영함이 되면 `daypage-suggestion` 채널 웹훅으로 알린다. 운영 `.env`의 `DISCORD_SUGGESTION_WEBHOOK`(비밀값, 저장소에 없음). 비면 알리지 않는다 |
| 배정 기록 | work `~/.daypage/suggestions-dispatched` (한 줄에 건의 id 하나), 전달 대기 `~/.daypage/suggestions-dispatched.pending` (`id 받은시각`) |
| 워커 프롬프트 | `docs/agents/suggestion-worker-prompt.md` (자동화에 넣은 본문과 같게 유지한다) |
| Orca 자동화 | work, 이름 "건의함 자동 처리", 매분, precheck = `scripts/suggestions.sh check`, provider claude, workspace = 기존 `~/workspace/daypage` main 체크아웃(새 worktree를 만들지 않는다, 워커는 읽기만 한다) |

흐름: 매분 precheck가 돈다 → 새 건의(status=new, 아직 배정 안 됨)가 없으면 0이 아닌 코드로 끝나 **아무것도 안 한다**(에이전트도 안 뜬다) → 있으면 워커가 `take`로 건의를 받고, 건의마다 `forward <id> <제목>`(본문은 표준 입력)으로 대장에게 보낸다.

건의가 사라지지 않게:
- `forward`가 「Sent msg_」를 못 보면 그 건의를 되돌린다(배정 기록을 지움). 다음 check에서 다시 잡힌다.
- `take` 뒤 워커가 `forward` 전에 죽으면 그 건의는 전달 대기로 남는다. 15분(`DAYPAGE_SUGGESTION_STALE`, 초)이 지나면 check·take에 다시 나온다.
- 보낼 곳은 `DAYPAGE_SUGGESTION_RELAY_TO`(기본 `run:run_e083f7b1d874`)·`DAYPAGE_SUGGESTION_RELAY_ENV`(기본 `windows`)로 바꾼다. 대장 회신 주소가 바뀌면 기본값을 고친다.

## work 쪽 준비물(한 번만)

- 워커는 `~/workspace/daypage`(이미 신뢰된 폴더)에서 돈다. 신뢰 대화가 뜨면 `~/.claude.json`의 `projects["/home/sandring/workspace/daypage"].hasTrustDialogAccepted`를 확인한다.
- work의 `orca`가 `windows` 환경과 짝지어져 있어야 대장 메일함에 닿는다.
- work → oracle ssh(Tailscale)와 `gh`·GitHub ssh 키가 있어야 한다.

## 처리

대장이 메일을 보고 daypage 조율자에게 지시한다. 조율자는 이슈·작업자·PR로 처리하고, 건의 상태는 `scripts/suggestions.sh status`로 바꾼다(`reviewing` 검토 중, `done` 반영함, `declined` 안 함). 검토 중·반영함은 디스코드 건의 채널에 알림이 간다. 운영 페이지에서 사람이 바꿔도 같은 알림이 간다(안 함·새 건의로 되돌림은 알리지 않는다). 자동화가 운영 DB에 쓰는 것은 없다(워커는 상태를 바꾸지 않는다).

## 손보기

```
orca-ide automations list --json                      # 자동화 id 찾기
orca-ide automations runs --id <id> --json            # 실행 기록(건너뜀 포함)
orca-ide automations edit <id> --disabled --json      # 잠시 끄기
orca-ide automations edit <id> --prompt "$(cat docs/agents/suggestion-worker-prompt.md)" --json   # 프롬프트 갱신
scripts/suggestions.sh list                           # 지금 새 건의 보기(배정 기록 안 바꿈)
scripts/suggestions.sh mark 7 8                       # 자동화가 건드리지 않게 건의 id 거르기
scripts/suggestions.sh untake 7                       # 배정 기록을 지워 다음 실행에서 다시 보내게 하기
scripts/suggestions.sh status 5 done "PR #50"         # 상태 바꾸기(검토 중·반영함은 디스코드에 알림)
```

work 밖(예: Windows)에서 같은 건의를 손으로 처리하면, 자동화가 또 잡지 않게 `mark`로 걸러 두거나 운영 페이지에서 상태를 바꾼다.
