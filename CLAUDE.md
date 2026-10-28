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

### 시험 시간 한도

백엔드 pytest는 시험 하나의 본문 CPU(이 프로세스 + 자식, 벽시계 아님)가 **1.0초**를 넘고 통과하면 실패로 바꾼다(`backend/tests/conftest.py`). 목표는 0.5초다. 넘으면 한도를 올리지 말고 원인을 줄인다. 올리는 일은 저장소 주인이 정한다. 환경변수 `DAYPAGE_TEST_CPU_LIMIT`(초, 0이면 끔)으로 바꾼다. 느린 시험 찾기: `POSTGRES_DB=daypage_tb uv run pytest -q --junitxml=out.xml` 후 `python3 ~/.claude/skills/test-speed-budget/snippets/junit_slowest.py out.xml 20 0.5`(junit 속성 `cpu_seconds`). 시험 DB 이름을 따로 줘서 다른 작업과 겹치지 않게 한다(`test_<이름>`이 끝에 남으면 지운다 — 시험 하나가 연결을 쥐어 정리가 실패하는 경고가 있다). 백엔드 분포(273건, 5회): 0.5초 초과 0건, 최대 0.43초(첫 요청 URLconf 적재, 미리 읽어 두어 0.17초로 내림). 프론트 vitest는 한도를 정하지 않았다(CPU로 못 재고 벽시계가 붐비면 부푼다). 분포: 499건, 0.5초 초과 약 13건, 최대 약 1.1초(jsdom 화면 시험). CI는 시험을 돌리지 않는다.

**시험에 고정 대기(`asyncio.sleep`·`time.sleep`·`setTimeout`)를 쓰지 않는다.** 기다릴 사건(`asyncio.Event`, timeout 있는 받기, `backend/tests/waiting.py`의 `until`, 프론트는 `vi.useFakeTimers`·`findBy*`)을 기다린다. 린트가 막는다: 백엔드 ruff `TID251`(`cd backend && uv run ruff check`, 설정은 `backend/pyproject.toml`의 banned-api, 정말 필요한 줄만 사유와 함께 `# noqa: TID251`), 프론트 oxlint `no-restricted-globals`·`no-restricted-properties`(`frontend/.oxlintrc.json`의 `*.test.ts(x)` 덮어쓰기, `pnpm lint`).

### 펜·터치 e2e

실기기 없이 iPad 프리셋 + CDP 펜·터치 입력으로 펜·손가락 경로를 Playwright로 덮는다. `cd frontend && pnpm e2e`(백엔드·프론트를 알아서 띄움, 시험 하나 3초 한도). 설명은 `frontend/README.md`의 「e2e」. CI는 돌리지 않는다.
