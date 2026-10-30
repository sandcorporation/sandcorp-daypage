# 이미지를 oracle 밖에서 굽기 (#99)

oracle(aarch64, 4코어)은 운영 서비스 열 개 남짓이 CPU를 나눠 쓴다. 배포할 때마다 거기서 이미지를 빌드하면 운영 서비스가 느려진다.
그래서 **이미지는 다른 노드에서 굽고 ghcr에 올리며, oracle은 받아서 교체만 한다.** 같은 패턴을 먼저 쓴 곳은 AI-Trend-News의 `docs/ops/offhost-build.md`(#142)다.

## 흐름

```
main push ─▶ 이미지 빌드 ─────────────────────▶ 배포(oracle)
             macos (M4 Pro, arm64 네이티브)       docker pull daypage-backend:<sha>, daypage-web-dist:<sha>
             └ 3분 안에 실행기를 못 잡으면        migrate → backend·backend2 하나씩 → 정적 파일 → Caddy reload → worker·beat → 헬스
               sub(built-in, QEMU로 arm64)         (빌드 없음, deploy/deploy.sh 절차는 그대로)
```

- **노드를 못 잡았을 때만** sub로 넘어간다. macos에서 빌드가 실패하면 실패로 끝낸다(다시 sub로 굽지 않는다).
- 빌드 노드는 콘솔(`== 빌드 노드: macos (...)`)과 빌드 설명(`<sha12> · 빌드 macos · oracle pull`)·디스코드 알림에 남는다.
- 이미지 둘: `ghcr.io/sandcorporation/daypage-backend:<커밋 sha 40자>`(backend·backend2·worker·beat가 같이 쓴다), `ghcr.io/sandcorporation/daypage-web-dist:<sha>`(정적 파일·Caddy 설정을 볼륨에 넣는 일회성 작업). 빌드 캐시는 `<이미지>-buildcache:arm64`(레지스트리, `mode=max`).
- 자격: ghcr 쓰기 `ghcr-push-token`(Secret text). oracle은 호스트 docker 설정에 있는 ghcr **읽기** 로그인을 쓴다. 비공개 의존성이 없어 SSH 키는 쓰지 않는다.
- Jenkins 잡 이름은 `sandcorp-daypage`, oracle 워크스페이스는 `/home/jenkins/agent/workspace/sandcorp-daypage`(`.env`가 여기 있다).

## 메트릭 스니펫 주소(#51)는 배포 때 넣는다

예전에는 `VITE_METRICS_SNIPPET_URL`을 프론트 빌드 인자로 받았다. 이미지를 oracle 밖에서 구우면 그 노드에는 워크스페이스 `.env`가 없으므로, 주소를 **빌드가 아니라 배포 때** `deploy/publish-static.sh`가 `index.html` head 끝에 넣는다(compose가 `.env`의 값을 `web-dist` 컨테이너 환경변수로 준다). 비어 있으면 태그가 없고, admin에는 넣지 않는다. 동작 규칙은 `frontend/metricsSnippet.ts`와 같다.

## 파라미터

| 이름 | 기본 | 뜻 |
|---|---|---|
| `BUILDER` | `auto` | `auto` / `macos` / `sub` — 시험용으로 빌드 노드를 강제 |
| `MAC_WAIT_SECONDS` | `180` | auto에서 macos 실행기를 기다리는 시간. 넘으면 sub |
| `ROLLBACK_SHA` | 빈 값 | 채우면 빌드 없이 그 커밋의 이미지로 되돌린다 |

## 이전 sha로 되돌리기

Jenkins `sandcorp-daypage`를 「Build with Parameters」로 `ROLLBACK_SHA=<되돌릴 커밋 sha 40자>`를 넣고 돌린다. 빌드 단계는 건너뛰고 oracle이 그 sha 이미지 둘을 pull해 같은 migrate·교체·헬스 절차를 밟는다.
- ghcr에 그 sha 이미지가 있어야 한다. oracle은 최신 3개만 로컬에 두고 나머지는 다시 pull한다.
- migrate는 앞으로만 간다. 되돌리는 코드가 새 스키마를 못 읽으면 DB를 따로 되돌려야 한다(파괴적 스키마 변경은 두 번에 나눠 배포하는 규칙 그대로).
- **옛 방식(oracle에서 굽기)으로 돌아가려면** 이 PR을 되돌린다(`git revert`). `DAYPAGE_*_IMAGE`가 없으면 `deploy.sh`는 예전처럼 로컬에서 빌드한다(`make`/수동 배포도 같다).

## 주의점

- Jenkins 스크립트 승인이 필요 없는 단계만 쓴다(`Jenkins.instance`·`nodesByLabel` 금지). 노드 대기 시간 제한은 `parallel(failFast)` + `sleep` 감시다.
- macos 실행기는 1개이고 다른 열차와 나눠 쓴다. 대기가 3분을 넘으면 sub로 간다.
- sub는 QEMU로 arm64를 굽는다. 캐시가 없으면 느리지만 레지스트리 캐시가 두 노드에서 공유된다.
- 빌드 노드의 `buildx`에 `docker-container` 빌더가 필요하다(스크립트가 `daypage-images`를 만든다).
- oracle 호스트의 docker가 `ghcr.io`에 읽기 로그인돼 있어야 한다. 패키지가 처음 올라오면 ghcr에서 `daypage-backend`·`daypage-web-dist`가 비공개로 만들어지니, 읽기 계정이 접근할 수 있는지 첫 배포에서 확인한다.
