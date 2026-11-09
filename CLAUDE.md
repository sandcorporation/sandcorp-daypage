## Agent skills

### Issue tracker

GitHub Issues(sandcorporation/sandcorp-daypage)에서 `gh` CLI로 관리. See `docs/agents/issue-tracker.md`.

### Triage labels

기본 라벨 5종(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) 그대로 사용. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Suggestion automation

운영 건의함은 work의 Orca 자동화가 10분마다 살펴 새 건의를 브랜치로 작업하고 검토 대기로 올린다. See `docs/agents/suggestion-automation.md`.

### 메트릭 스니펫

`frontend/index.html` head 끝의 메트릭 스크립트는 빌드 env `VITE_METRICS_SNIPPET_URL`이 비어 있지 않을 때만 들어간다(`frontend/metricsSnippet.ts`, 비면 태그 없음; admin에는 없음). 운영은 워크스페이스 `.env` → compose `web-dist` 환경변수 → 배포 때 `deploy/publish-static.sh`가 `index.html`에 넣는다(이미지를 oracle 밖에서 굽기 때문에 빌드 인자가 아니다, #99, `docs/ops/offhost-build.md`).

### 배포 이미지

main 병합 뒤 Jenkins(`sandcorp-daypage`)가 공용 라이브러리 `sandcorp`(sandcorporation/jenkins-shared `sandcorpDeploy`; `Jenkinsfile`은 이 저장소 값만 넘기는 호출 하나)로 배포한다: main이 직전 성공 배포 뒤로 안 움직였으면(작업 브랜치 push 등) `NOT_BUILT`로 끝나고, 아니면 빌드 노드(macos, 못 잡으면 home)에서 `scripts/ci/check.sh` 뒤 이미지 둘을 굽고 ghcr에 올리며, oracle은 pull한 뒤 `deploy/deploy.sh`(무중단 순서)만 돌린다. 실패하면 직전 성공 sha 이미지로 같은 스크립트를 `SANDCORP_ROLLBACK=1`(migrate 건너뜀)로 다시 돌려 무중단으로 되돌린다 — 이 순서를 바꾸면 `bash deploy/deploy_test.sh`를 같이 고친다. 파라미터·되돌리기는 `docs/ops/offhost-build.md`.

### PR 검사

PR을 열면 Jenkins `sandcorp-daypage-pr`(멀티브랜치, `Jenkinsfile.pr` → 라이브러리 `sandcorpPrCheck`)가 빌드 노드에서 PR 머지 결과로 파괴적 migrate 검사와 `scripts/ci/check.sh`(배포 스크립트 시험·백엔드 ruff·pytest·프론트 lint·typecheck·vitest·admin typecheck·vitest를 도커 안에서)를 돌려 PR head 커밋 상태 `continuous-integration/jenkins/pr-merge`로 올린다. 시험이 실패하면 그 시험만 좁혀(`-k`, 파일 지정, vitest 파일 지정) 다시 돌린다. 시험 묶음 전체(`make check`·`make test` 전체·`scripts/ci/check.sh`)는 로컬에서 돌리지 않는다. 로컬에서는 바꾼 부분과 관련된 시험·lint·typecheck만 돌리고, PR을 열어 `wait-ci.py <PR>`로 PR 검사 잡 결과를 기다린다. CI가 실패하면 실패한 시험만 로컬에서 좁혀 고친 뒤 다시 push한다(작업자가 시험 하나 실패에 전체 묶음을 다시 돌려 시간을 썼다, 2026-11-02 대표 지적). 작업자는 `wait-ci.py <PR>`가 SUCCESS일 때만 병합한다(main 직접 push 금지, 보호 규칙이 없어 이 규칙과 배포 전 검사가 강제다). migrate는 옛 백엔드가 도는 동안 돌고 롤백은 migrate를 되돌리지 않으므로, 지우기·이름 바꾸기·null 불가 전환·`db_default` 없는 null 불가 새 열은 PR 검사가 막는다 — expand/contract 두 배포로 나누고 contract 쪽 파일에 `# sandcorp: destructive-ok — <이유>`(jenkins-shared README 「파괴적 migrate 검사」).

GitHub Actions 워크플로 `.github/workflows/pr-check.yml`(ubuntu-latest, 읽기 권한, secrets 없음, 공식 액션 SHA 고정)도 PR마다 같은 검사를 job으로 나눠 돈다. 파괴적 migrate 검사는 `scripts/ci/migrate-guard.{sh,py}`(jenkins-shared 복사본)를 쓴다. Jenkins PR 잡은 공개 전환 뒤 정리한다.

### 시험 시간 한도

백엔드 pytest는 시험 하나의 본문 CPU(이 프로세스 + 자식, 벽시계 아님)가 **1.0초**를 넘고 통과하면 실패로 바꾼다(`backend/tests/conftest.py`). 목표는 0.5초다. 넘으면 한도를 올리지 말고 원인을 줄인다. 올리는 일은 저장소 주인이 정한다. 환경변수 `DAYPAGE_TEST_CPU_LIMIT`(초, 0이면 끔)으로 바꾼다. 느린 시험 찾기: `POSTGRES_DB=daypage_tb uv run pytest -q --junitxml=out.xml` 후 `python3 ~/.claude/skills/test-speed-budget/snippets/junit_slowest.py out.xml 20 0.5`(junit 속성 `cpu_seconds`). 시험 DB 이름을 따로 줘서 다른 작업과 겹치지 않게 한다(`test_<이름>`이 끝에 남으면 지운다 — 시험 하나가 연결을 쥐어 정리가 실패하는 경고가 있다). 백엔드 분포(273건, 5회): 0.5초 초과 0건, 최대 0.43초(첫 요청 URLconf 적재, 미리 읽어 두어 0.17초로 내림). 프론트 vitest는 한도를 정하지 않았다(CPU로 못 재고 벽시계가 붐비면 부푼다). 분포: 499건, 0.5초 초과 약 13건, 최대 약 1.1초(jsdom 화면 시험). PR 검사·배포 전 검사(`scripts/ci/check.sh`)가 같은 한도로 시험을 돌린다.

**시험에 고정 대기(`asyncio.sleep`·`time.sleep`·`setTimeout`)를 쓰지 않는다.** 기다릴 사건(`asyncio.Event`, timeout 있는 받기, `backend/tests/waiting.py`의 `until`, 프론트는 `vi.useFakeTimers`·`findBy*`)을 기다린다. 린트가 막는다: 백엔드 ruff `TID251`(`cd backend && uv run ruff check`, 설정은 `backend/pyproject.toml`의 banned-api, 정말 필요한 줄만 사유와 함께 `# noqa: TID251`), 프론트 oxlint `no-restricted-globals`·`no-restricted-properties`(`frontend/.oxlintrc.json`의 `*.test.ts(x)` 덮어쓰기, `pnpm lint`).

### 펜·터치 e2e

실기기 없이 iPad 프리셋 + CDP 펜·터치 입력으로 펜·손가락 경로를 Playwright로 덮는다. `cd frontend && pnpm e2e`(백엔드·프론트를 알아서 띄움, 시험 하나 3초 한도). 설명은 `frontend/README.md`의 「e2e」. PR 검사(`scripts/ci/check.sh`)는 e2e를 돌리지 않는다.
