# 이미지를 oracle 밖에서 굽기 (#99) · 공용 라이브러리 (jenkins-shared #3)

oracle(aarch64, 4코어)은 운영 서비스 열 개 남짓이 CPU를 나눠 쓴다. 배포할 때마다 거기서 이미지를 빌드하면 운영 서비스가 느려진다.
그래서 **이미지는 다른 노드에서 굽고 ghcr에 올리며, oracle은 받아서 교체만 한다.**

파이프라인은 Jenkins 공용 라이브러리 `sandcorp`(저장소 sandcorporation/jenkins-shared, `vars/sandcorpDeploy.groovy`)에 있다.
이 저장소의 `Jenkinsfile`은 `@Library('sandcorp') _`와 `sandcorpDeploy(...)` 호출 하나이고 이 저장소가 넘기는 값만 담는다.
공통 동작·인자 목록·노드 라벨을 바꾸는 곳은 jenkins-shared `README.md`가 원문이다.
daypage는 배포 순서가 라이브러리 기본과 달라서(backend 두 대 롤링·Caddy reload) **`deployScript: 'deploy/deploy.sh'`**로 저장소 스크립트를 쓴다.

## 흐름

```
GitHub push ─▶ 배포할 커밋 확인 ─▶ 이미지 빌드 ─────────────────────▶ 배포(oracle, deploy/deploy.sh)
               (built-in)           macos (M4 Pro, arm64 네이티브)      docker pull daypage-backend:<sha>, daypage-web-dist:<sha>
               main 이 지난 배포     └ 3분 안에 실행기를 못 잡으면        migrate → backend·backend2 하나씩 → 정적 파일
               뒤로 안 움직였으면      home(built-in, QEMU로 arm64)       → Caddy reload → worker·beat → 헬스
               NOT_BUILT로 끝         검사(scripts/ci/check.sh) 먼저      실패 → 직전 성공 이미지로 같은 스크립트(SANDCORP_ROLLBACK=1)
```

- **작업 브랜치 push는 배포 없이 끝난다.** 웹훅은 브랜치 생성·push·삭제에도 잡을 깨우지만, 잡은 늘 main을 받는다. main sha가 직전 성공 빌드의 sha와 같으면 `NOT_BUILT`(디스코드 알림 없음).
- **배포 전 검사**: 빌드 노드에서 이미지를 굽기 전에 `bash scripts/ci/check.sh`가 돈다. 순서는 배포 스크립트 시험(`deploy/deploy_test.sh`, 가짜 docker), 그다음 도커 안에서 백엔드 ruff·pytest(이 실행만의 Postgres·Redis), 프론트 lint·typecheck·vitest, admin typecheck·vitest다. 실패하면 굽지도 배포하지도 않는다(GitHub 무료 요금제라 병합을 막지 못해 여기서 막는다). 같은 검사가 PR 때도 돈다: 멀티브랜치 잡 `sandcorp-daypage-pr`(`Jenkinsfile.pr`, 라이브러리 `sandcorpPrCheck`)가 파괴적 migrate 검사와 함께 돌려 PR 상태로 올리고, 작업자는 `wait-ci.py` 통과 뒤 병합한다.
- **노드를 못 잡았을 때만** home으로 넘어간다. macos에서 검사·빌드가 실패하면 실패로 끝낸다.
- 빌드 노드는 콘솔(`== 빌드 노드: macos (...)`)과 빌드 설명(`<sha12> · 빌드 macos · oracle pull`)·디스코드 알림(`[Daypage]`)에 남는다.
- **배포 결과는 main 커밋 상태 `sandcorp/deploy`에도 남는다**(시작 `pending`, 끝 `success`/`failure`; 실패하면 병합된 PR에 「배포 실패 — 」 댓글). Jenkins 자격이 없는 작업자는 `wait-deploy.py --job sandcorp-daypage --pr <N>`이 이 상태를 기다린다(jenkins-shared README 「배포 결과(GitHub)」).
- 이미지 둘: `ghcr.io/sandcorporation/daypage-backend:<커밋 sha 40자>`(backend·backend2·worker·beat가 같이 쓴다, `backend/Dockerfile`·문맥 `backend`), `ghcr.io/sandcorporation/daypage-web-dist:<sha>`(정적 파일·Caddy 설정을 볼륨에 넣는 일회성 작업, `deploy/web.Dockerfile`·문맥 저장소 루트). 빌드 캐시는 `<이미지>-buildcache:arm64`(레지스트리, `mode=max`, buildx 빌더 `daypage-images`). `source` 레이블은 저장소 주소 `sandcorporation/sandcorp-daypage`다(2026-11-04에 `daypasge`에서 이름을 바꿨다).
- 자격: ghcr 쓰기 `ghcr-push-token`, 디스코드 `discord-deploy-webhook`. oracle은 호스트 docker 설정에 있는 ghcr **읽기** 로그인을 쓴다. 비공개 의존성이 없어 SSH 키는 쓰지 않는다.
- Jenkins 잡 이름은 `sandcorp-daypage`, oracle 워크스페이스는 `/home/jenkins/agent/workspace/sandcorp-daypage`(`.env`가 여기 있다).

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

## 파라미터

| 이름 | 기본 | 뜻 |
|---|---|---|
| `BUILDER` | `auto` | `auto` / `macos` / `home` — 시험용으로 빌드 노드를 강제 |
| `MAC_WAIT_SECONDS` | `180` | auto에서 macos 실행기를 기다리는 시간. 넘으면 home |
| `ROLLBACK_SHA` | 빈 값 | 채우면 빌드 없이 그 커밋의 이미지로 되돌린다(이미 배포한 sha여도) |

## 이전 sha로 되돌리기

Jenkins `sandcorp-daypage`를 「Build with Parameters」로 `ROLLBACK_SHA=<되돌릴 커밋 sha 40자>`를 넣고 돌린다. 빌드 단계는 건너뛰고 oracle이 그 sha 이미지 둘을 pull해 `deploy/deploy.sh`의 같은 migrate·교체·헬스 절차를 밟는다(compose 파일·스크립트는 지금 main 것).
- ghcr에 그 sha 이미지가 있어야 한다. oracle은 최신 3개만 로컬에 두고 나머지는 다시 pull한다.
- migrate는 앞으로만 간다. 되돌리는 코드가 새 스키마를 못 읽으면 DB를 따로 되돌려야 한다(파괴적 스키마 변경은 두 번에 나눠 배포하는 규칙 그대로).
- 되돌린 뒤 main이 그대로면 다음 작업 브랜치 push는 건너뛴다(되돌린 상태 유지). 다음 main 병합이 다시 배포한다.
- `DAYPAGE_*_IMAGE`가 없으면 `deploy.sh`는 로컬에서 빌드한다(수동 배포·로컬 운영 구성 확인).

## 주의점

- macos 실행기는 1개이고 다른 열차와 나눠 쓴다. 대기가 3분을 넘으면 home으로 간다. home은 QEMU라 캐시가 없으면 느리다(레지스트리 캐시를 두 노드가 공유). 검사 이미지는 노드의 네이티브 아키텍처로 굽는다.
- oracle 호스트의 docker가 `ghcr.io`에 읽기 로그인돼 있어야 한다.
- 병합 뒤 첫 빌드가 돌아야 파라미터가 잡에 등록된다.
