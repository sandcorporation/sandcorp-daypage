## Agent skills

### Issue tracker

GitHub Issues(sandcorporation/daypasge)에서 `gh` CLI로 관리. See `docs/agents/issue-tracker.md`.

### Triage labels

기본 라벨 5종(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) 그대로 사용. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Suggestion automation

운영 건의함은 sub2의 Orca 자동화가 10분마다 살펴 새 건의를 브랜치로 작업하고 검토 대기로 올린다. See `docs/agents/suggestion-automation.md`.

### 메트릭 스니펫

`frontend/index.html` head 끝의 메트릭 스크립트는 빌드 env `VITE_METRICS_SNIPPET_URL`이 비어 있지 않을 때만 들어간다(`frontend/metricsSnippet.ts`, 비면 태그 없음; admin에는 없음). 운영은 워크스페이스 `.env` → compose build args → `deploy/web.Dockerfile` ARG로 전달된다(#51).
