# 이미지를 oracle 밖에서 굽기 (#99) · 공용 라이브러리 (jenkins-shared #3)

oracle(aarch64, 4코어)은 운영 서비스 열 개 남짓이 CPU를 나눠 쓴다. 배포할 때마다 거기서 이미지를 빌드하면 운영 서비스가 느려진다.
그래서 **이미지는 다른 노드에서 굽고 ghcr에 올리며, oracle은 받아서 교체만 한다.**

파이프라인은 Jenkins 공용 라이브러리 `sandcorp`(저장소 sandcorporation/jenkins-shared, `vars/sandcorpDeploy.groovy`)에 있다.
이 저장소의 `Jenkinsfile`은 `@Library('sandcorp') _`와 `sandcorpDeploy(...)` 호출 하나이고 이 저장소가 넘기는 값만 담는다.
공통 동작·인자 목록·노드 라벨을 바꾸는 곳은 jenkins-shared `README.md`가 원문이다.
daypage는 배포 순서가 라이브러리 기본과 달라서(backend 두 대 롤링·Caddy reload) **`deployScript: 'deploy/deploy.sh'`**로 저장소 스크립트를 쓴다.

## 흐름: Actions가 검사·굽고 production을 승격, Jenkins는 production만 배포 (#126, 2026-11-09)

sandcorp-metrics에서 검증한 흐름(#32)을 그대로 옮겼다.

```
PR ─▶ pr-check(Actions) ─▶ main 병합
main push ─▶ Actions release.yml
               check   pr-check.yml을 workflow_call — PR과 같은 검사(deploy-test·backend·frontend·admin·승격 스크립트 시험)
               image   needs check — image.yml(workflow_call, ubuntu-24.04-arm matrix 두 줄)
                       ─▶ ghcr.io/sandcorporation/daypage-backend:<sha>, daypage-web-dist:<sha>
               promote needs check·image — production 브랜치를 <sha>로 fast-forward(GITHUB_TOKEN, contents: write는 이 잡만)
production push(웹훅) ─▶ Jenkins sandcorp-daypage(잡 브랜치 */production)
               굽지 않음·검사 없음 → oracle: 이미지 둘이 ghcr에 있는지(상한 5분) → pull → deploy/deploy.sh
               (migrate → backend·backend2 하나씩 → 정적 파일 → Caddy reload → worker·beat → 헬스)
               실패 → 직전 성공 이미지로 같은 스크립트(SANDCORP_ROLLBACK=1)
```

- **production 브랜치 머리 = 운영 버전.** main 검사가 깨지면 이미지도 승격도 없다. production은 bbfeb57에서 시작했다.
- 승격은 `scripts/ci/promote.sh ff <sha>`: fast-forward만(강제 없음). production이 이미 더 새 판이면(옛 실행이 늦게 끝남) 실패가 아니라 「건너뜀」. 승격은 concurrency 그룹 `production-branch`로 하나씩. 시험은 `scripts/ci/promote_test.sh`(pr-check의 deploy-test 잡이 돌린다). 세 파일은 sandcorp-metrics에서 그대로 복사했다.
- GITHUB_TOKEN의 push는 다른 워크플로를 깨우지 않는다(production push로 Actions가 다시 돌지 않는다). 저장소 웹훅은 깨운다 — Jenkins `githubPush`가 그것을 받는다.
- main push·작업 브랜치 push도 웹훅으로 Jenkins를 깨우지만, production이 직전 성공 배포 뒤로 움직이지 않았으면 `NOT_BUILT`(디스코드 알림 없음).
- Jenkins 쪽 규칙은 jenkins-shared `sandcorpDeploy(deployFrom: 'production')`(README 「승격 브랜치에서 배포」). 이미지를 못 찾으면 교체 전에 실패하고(`이미지 기다리기`, 콘솔에 `imageWaitHint`의 release 워크플로 주소) 살아 있는 서비스는 그대로다.
- 빌드 노드는 콘솔·빌드 설명(`<sha12> · 빌드 actions · oracle pull`)·디스코드 알림(`[Daypage]`)에 남는다.
- **배포 결과는 배포한 커밋의 상태 `sandcorp/deploy`에도 남는다**(시작 `pending`, 끝 `success`/`failure`; 실패하면 병합된 PR에 「배포 실패 — 」 댓글). Jenkins 자격이 없는 작업자는 `wait-deploy.py --job sandcorp-daypage --pr <N>`이 이 상태를 기다린다(jenkins-shared README 「배포 결과(GitHub)」). 병합부터 승격까지 Actions가 먼저 1~2분 걸린다.
- 이미지 둘: `ghcr.io/sandcorporation/daypage-backend:<커밋 sha 40자>`(backend·backend2·worker·beat가 같이 쓴다, `backend/Dockerfile`·문맥 `backend`), `ghcr.io/sandcorporation/daypage-web-dist:<sha>`(정적 파일·Caddy 설정을 볼륨에 넣는 일회성 작업, `deploy/web.Dockerfile`·문맥 저장소 루트). `linux/arm64`, provenance 없음, 라벨 `org.opencontainers.image.source`(저장소 주소 `sandcorporation/sandcorp-daypage`)·`org.opencontainers.image.revision`(sha) — 옛 Jenkins 빌드(jenkins-shared `build-image.sh`)와 같다. 빌드 인자는 없다(메트릭 스니펫은 배포 때 넣는다, 아래).
- 이미지 워크플로: 이미지마다 잡 하나(`strategy.matrix.include`, `fail-fast: false`). 이미지를 더하면 include에 한 줄 더하고 같은 목록을 `Jenkinsfile`의 `images`에도 적는다(비상 길이 그 목록으로 굽는다). Actions 빌드 캐시는 같은 패키지의 `:buildcache` 태그(레지스트리, `mode=max`).
- GITHUB_TOKEN으로 push하려면 ghcr 패키지 둘의 「Manage Actions access」에 이 저장소가 Write로 있어야 한다. 옛 패키지는 Jenkins(개인 토큰)가 만들어 처음엔 `permission_denied`가 난다 — 패키지를 지우고 Actions가 다시 만들게 한다(대장 몫).
- 보안(공개 저장소): `pull_request_target` 없음, GitHub 호스팅 실행기만, 액션 SHA 고정, GITHUB_TOKEN 말고 secrets 없음, 워크플로 기본 권한 없음(잡마다 최소, `packages: write`는 image만).
- production 브랜치 보호: ruleset으로 강제 push·삭제 금지(bypass는 조직 관리자만). **production은 앞으로만 간다.** GitHub Actions 앱을 bypass로 둘 수 없어(422) 「Actions만 push」는 강제할 수 없다 — 사람이 production에 손으로 push하지 않는 것은 약속이다.
- 자격(Jenkins): 디스코드 `discord-deploy-webhook`, 비상 길의 ghcr 쓰기 `ghcr-push-token`. oracle은 호스트 docker 설정에 있는 ghcr **읽기** 로그인을 쓴다. 비공개 의존성이 없어 SSH 키는 쓰지 않는다.
- Jenkins 잡 이름은 `sandcorp-daypage`, oracle 워크스페이스는 `/home/jenkins/agent/workspace/sandcorp-daypage`(`.env`가 여기 있다).

## 비상 길: Jenkins가 oracle 밖에서 굽는다 (`BUILD_ON=jenkins`)

Actions가 못 구울 때 Jenkins 「Build with Parameters」에서 `BUILD_ON=jenkins`. 지금 production 머리를 굽고 배포한다(이미지 대기 없음).

```
production ─▶ 이미지 빌드 ─────────────────────▶ 배포(oracle, deploy/deploy.sh)
             macos (M4 Pro, arm64 네이티브)       위와 같다
             └ 3분 안에 실행기를 못 잡으면
               home(built-in, QEMU로 arm64)
             검사(scripts/ci/check.sh)와 나란히
```

- `Jenkinsfile`의 `images`(dockerfile·context)마다 jenkins-shared `build-image.sh`로 굽는다 — 이름·태그·라벨은 Actions와 같고 캐시만 `<이미지>-buildcache:arm64`(buildx 빌더 `daypage-images`)다.
- 배포 전 검사 `bash scripts/ci/check.sh`(Jenkinsfile `check`)는 이 길에서만 돈다. 순서는 배포 스크립트 시험(`deploy/deploy_test.sh`, 가짜 docker), 그다음 도커 안에서 백엔드 ruff·pytest(이 실행만의 Postgres·Redis), 프론트 lint·typecheck·vitest, admin typecheck·vitest다. 실패하면 배포하지 않는다.
- **노드를 못 잡았을 때만** home으로 넘어간다. macos에서 검사·빌드가 실패하면 실패로 끝낸다.

## 무중단과 자동 롤백

`deploy/deploy.sh`는 한꺼번에 내리지 않는다. migrate는 옛 backend가 요청을 받는 동안 돌고, backend를 바꾼 뒤 healthy가 되어야 backend2를 바꾼다(그동안 Caddy가 살아 있는 쪽으로 보낸다). Caddy는 다시 만들지 않고 설정만 reload한다.

라이브러리는 이 스크립트를 `DAYPAGE_BACKEND_IMAGE`·`DAYPAGE_WEB_DIST_IMAGE`(새 sha)와 `SANDCORP_ROLLBACK=0`으로 부른다. **0이 아니게 끝나면** 직전 성공 빌드의 sha 이미지로 **같은 스크립트를 `SANDCORP_ROLLBACK=1`로 한 번 더** 부른다. 스크립트는 그때 migrate를 건너뛰고 같은 순서로 되돌린다.
- 새 backend가 healthy가 안 되면 스크립트는 backend2를 건드리기 전에 멈춘다. backend2(옛 이미지)가 계속 받는 동안 롤백이 backend를 옛 이미지로 다시 만들고, backend2는 이미지가 같아 그대로 둔다.
- 마지막 헬스 확인이 실패하면(두 backend 모두 새 이미지) 롤백도 backend → healthy → backend2 순서로 하나씩 되돌린다. 정적 파일도 옛 이미지로 다시 넣는다.
- pull·migrate에서 멈추면 backend는 아직 옛 이미지라, 롤백 호출은 아무것도 다시 만들지 않는다(정적 파일만 옛 것으로 다시 넣는다).
- 빌드는 `FAILURE`, 디스코드에는 「↩️ 자동 롤백」. 롤백도 실패하면 「🚨」. migrate는 되돌리지 않는다(옛 코드가 새 스키마와 호환돼야 한다 — PR의 파괴적 migrate 검사).
- 운영에서 일부러 깨뜨려 시험하지 않는다. `bash deploy/deploy_test.sh`가 가짜 docker로 이 두 번 부르기를 그대로 흉내 내어 성공·healthy 실패·헬스 실패·migrate 실패를 돌리고, 「backend를 다시 만드는 순간 다른 backend가 healthy가 아니면 실패」(무중단)와 「롤백 때 migrate 없음」을 본다.
- 같은 sha는 push가 다시 깨워도 배포하지 않는다(깨진 커밋이 브랜치 push마다 배포·롤백을 되풀이하지 않게). 다시 해 보려면 「Build Now」.

## 메트릭 스니펫 주소(#51)는 배포 때 넣는다

예전에는 `VITE_METRICS_SNIPPET_URL`을 프론트 빌드 인자로 받았다. 이미지를 oracle 밖에서 구우면 그 노드에는 워크스페이스 `.env`가 없으므로, 주소를 **빌드가 아니라 배포 때** `deploy/publish-static.sh`가 `index.html` head 끝에 넣는다(compose가 `.env`의 값을 `web-dist` 컨테이너 환경변수로 준다). 비어 있으면 태그가 없고, admin에는 넣지 않는다. 동작 규칙은 `frontend/metricsSnippet.ts`와 같다.

## 오류 수집 release는 배포 sha다(#119)

`sandcorpDeploy`가 배포 스크립트에 주는 `SANDCORP_IMAGE_SHA`(커밋 sha 40자, 롤백이면 직전 sha)를 `docker-compose.prod.yml`이 backend·worker·beat에 `SENTRY_RELEASE`로 넘긴다. 백엔드 GlitchTip 이벤트와 `/api/client-config`의 `release`(프론트 이벤트)가 이 값을 쓴다. 연동 확인은 운영 backend 컨테이너에서 `python manage.py glitchtip_test "연동 시험 daypage <날짜>"`(이벤트 id를 찍는다, SDK가 꺼져 있으면 0이 아닌 코드). 규칙은 `backend/config/sentry.py` 머리말.

## 파라미터

| 이름 | 기본 | 뜻 |
|---|---|---|
| `BUILD_ON` | `actions` | `actions` = Actions가 구워 승격한 production 머리의 이미지를 받아 배포 / `jenkins` = 비상 길로 굽는다 |
| `BUILDER` | `auto` | `auto` / `macos` / `home` — 비상 길에서 빌드 노드를 강제 |
| `MAC_WAIT_SECONDS` | `180` | auto에서 macos 실행기를 기다리는 시간. 넘으면 home |
| `ROLLBACK_SHA` | 빈 값 | 비상 되돌리기: 채우면 빌드 없이 그 커밋의 이미지로 배포한다(production은 그대로) |

## 이전 sha로 되돌리기

production은 앞으로만 간다(강제 push 금지). 그래서 되돌리기도 「앞으로 가는 커밋」으로 한다. production을 옛 sha로 옮기는 워크플로는 두지 않는다.

**정석: main에 revert PR.** `git revert <나쁜 커밋>` → PR → pr-check 초록 → 병합. release.yml이 검사 → 이미지 → 승격(fast-forward)을 그대로 밟고 Jenkins가 그 sha를 배포한다. 운영과 main이 어긋나지 않는다.

**급할 때(검사·이미지를 기다릴 수 없을 때): Jenkins `ROLLBACK_SHA`.** `sandcorp-daypage` 「Build with Parameters」 → `ROLLBACK_SHA=<되돌릴 커밋 sha 40자>`. 굽기·검사 없이 ghcr에 그 sha 이미지 둘이 있는지 보고(상한 5분) oracle이 pull해 `deploy/deploy.sh`의 같은 migrate·교체·헬스 절차를 밟는다(compose 파일·스크립트는 지금 production 것).
- production은 그대로라 다음 승격(main 병합)이 다시 앞으로 간다 — 곧바로 revert PR을 넣어 main을 맞춘다.
- ghcr에 그 sha 이미지가 있어야 한다. oracle은 최신 3개만 로컬에 두고 나머지는 다시 pull한다.

공통: migrate는 앞으로만 간다. 되돌리는 코드가 새 스키마를 못 읽으면 DB를 따로 되돌려야 한다(파괴적 스키마 변경은 두 번에 나눠 배포하는 규칙 그대로).
- `DAYPAGE_*_IMAGE`가 없으면 `deploy.sh`는 로컬에서 빌드한다(수동 배포·로컬 운영 구성 확인).

## 주의점

- (비상 길) macos 실행기는 1개이고 다른 열차와 나눠 쓴다. 대기가 3분을 넘으면 home으로 간다. home은 QEMU라 캐시가 없으면 느리다(레지스트리 캐시를 두 노드가 공유). 검사 이미지는 노드의 네이티브 아키텍처로 굽는다.
- oracle 호스트의 docker가 `ghcr.io`에 읽기 로그인돼 있어야 한다.
- 병합 뒤 첫 빌드가 돌아야 파라미터가 잡에 등록된다.
