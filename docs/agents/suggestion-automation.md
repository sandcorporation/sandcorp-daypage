# 건의함 자동 처리 (sub2의 Orca 자동화)

운영 건의함(`daypage_suggestion`)에 새 건의가 들어오면 sub2의 Orca가 새 worktree(브랜치)를 만들고 Claude 워커가
구현한 뒤 **검토 중(in-review)** 으로 올려 두고 멈춘다. 사람이 그 worktree 터미널에서 "승인"이라고 답해야 main에
push(=운영 배포)된다.

## 구성

| 것 | 어디 |
|---|---|
| 건의 조회·상태 스크립트 | `scripts/suggestions.sh` (조회는 읽기 전용 SELECT, ssh `oracle` → `daypage-postgres-1`. `status`만 `daypage-backend-1`의 관리 명령으로 상태 칸을 바꾼다) |
| 디스코드 알림 | 새 건의·검토 중·반영함이 되면 `daypage-suggestion` 채널 웹훅으로 알린다. 운영 `.env`의 `DISCORD_SUGGESTION_WEBHOOK`(비밀값, 저장소에 없음). 비면 알리지 않는다 |
| 배정 기록 | sub2 `~/.daypage/suggestions-dispatched` (한 줄에 건의 id 하나) |
| 워커 프롬프트 | `docs/agents/suggestion-worker-prompt.md` (자동화에 넣은 본문과 같게 유지한다) |
| Orca 자동화 | sub2, 이름 "건의함 자동 처리", 10분마다, precheck = `scripts/suggestions.sh check`, provider claude, repo daypage(실행마다 새 worktree) |

흐름: 10분마다 precheck가 돈다 → 새 건의(status=new, 아직 배정 안 됨)가 없으면 0이 아닌 코드로 끝나 **아무것도 안 한다**(에이전트도 안 뜬다) → 있으면 main에서 worktree를 만들고 워커가 `take`로 건의를 받아 작업한다.

## sub2 쪽 준비물(한 번만)

- Claude Code는 처음 보는 폴더마다 "이 폴더를 신뢰합니까?"를 묻고 멈춘다. 실행마다 새 worktree가
  `~/orca/workspaces/daypage/auto-run-N-…`에 생기므로 **부모 폴더를 미리 신뢰**해 둔다:
  `~/.claude.json`의 `projects["/home/sandring/orca/workspaces/daypage"].hasTrustDialogAccepted = true`.
  (2026-10-21에 해 두었다. 신뢰 대화가 다시 뜨면 이것부터 확인한다.)
- 개발용 DB: `docker compose up -d postgres redis` (백엔드 테스트용).
- sub2 → oracle ssh(Tailscale)와 `gh`·GitHub ssh 키가 있어야 한다.

## 승인·반려

Orca 사이드바에서 **검토 중** 카드(읽지 않음 표시)를 열어 워커의 요약을 읽는다.
- `승인` → rebase·테스트·push·배포 확인까지 워커가 한다. 카드는 완료로 바뀐다.
- 고칠 점을 적으면 반영하고 다시 검토를 요청한다.
- `보류` / `안 함` → 커밋만 남기고 끝낸다.

건의 상태는 워커가 `scripts/suggestions.sh status`로 바꾼다: 건의를 받으면 `reviewing`(검토 중), 승인받아 배포를 확인하면 `done`(반영함), "안 함"이면 `declined`. "보류"는 검토 중으로 둔다. 운영 페이지에서 사람이 바꿔도 같은 알림이 간다(안 함·새 건의로 되돌림은 알리지 않는다). 자동화가 운영 DB에 쓰는 것은 이 상태 칸 하나뿐이다.

## 손보기

```
orca-ide automations list --json                      # 자동화 id 찾기
orca-ide automations runs --id <id> --json            # 실행 기록(건너뜀 포함)
orca-ide automations edit <id> --disabled --json      # 잠시 끄기
orca-ide automations edit <id> --prompt "$(cat docs/agents/suggestion-worker-prompt.md)" --json   # 프롬프트 갱신
scripts/suggestions.sh list                           # 지금 새 건의 보기(배정 기록 안 바꿈)
scripts/suggestions.sh mark 7 8                       # 자동화가 건드리지 않게 건의 id 거르기
scripts/suggestions.sh status 5 done "PR #50"         # 상태 바꾸기(검토 중·반영함은 디스코드에 알림)
```

sub2 밖(예: Windows)에서 같은 건의를 손으로 처리하면, 자동화가 또 잡지 않게 `mark`로 걸러 두거나 운영 페이지에서 상태를 바꾼다.
