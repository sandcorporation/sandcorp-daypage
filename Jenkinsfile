// 운영 = production 브랜치 머리(#126). 이 잡은 production만 배포한다(잡 브랜치 지정자 */production).
//   main push → GitHub Actions release.yml: 검사(pr-check)·이미지(image.yml, ubuntu-24.04-arm) 병렬 → 둘 다 초록이면 production fast-forward
//   production push → 여기: 굽지도 검사하지도 않는다. 이미지 둘이 ghcr에 있는지 짧게(5분) 보고 oracle에서 pull → deploy/deploy.sh
//   BUILD_ON=jenkins  비상 길: Actions가 못 구울 때 images(dockerfile·context)를 macos/home에서 굽고 check와 함께 배포.
//   ROLLBACK_SHA      비상 되돌리기: 빌드 없이 그 sha의 이미지로 배포(production은 그대로). 정석은 main에 revert PR.
//
// 배포 파이프라인은 Jenkins 공용 라이브러리 sandcorp(sandcorporation/jenkins-shared)의 sandcorpDeploy에 있다.
// 여기에는 이 저장소가 넘기는 값만 둔다. 동작(작업 브랜치 push 무시·이미 배포한 sha 건너뜀·배포 전 검사·mac 우선 빌드·
// oracle pull 배포·실패 시 자동 롤백·디스코드 알림)과 인자 목록은 jenkins-shared README, 이 저장소 사정은 docs/ops/offhost-build.md.
//
// 배포 순서는 라이브러리 것이 아니라 deploy/deploy.sh(무중단: migrate → backend·backend2 하나씩 → 정적 파일 → Caddy reload
// → worker·beat → 헬스)다(deployScript). 실패하면 라이브러리가 직전 성공 sha 이미지로 같은 스크립트를 SANDCORP_ROLLBACK=1로
// 다시 부르고, 스크립트는 그때 migrate를 건너뛰고 같은 순서로 되돌린다. 시험: deploy/deploy_test.sh.
@Library('sandcorp') _

sandcorpDeploy(
  name: 'Daypage',
  deployFrom: 'production',
  images: [
    [repo: 'ghcr.io/sandcorporation/daypage-backend', envVar: 'DAYPAGE_BACKEND_IMAGE', dockerfile: 'backend/Dockerfile', context: 'backend'],
    [repo: 'ghcr.io/sandcorporation/daypage-web-dist', envVar: 'DAYPAGE_WEB_DIST_IMAGE', dockerfile: 'deploy/web.Dockerfile', context: '.'],
  ],
  // images는 image.yml matrix와 같은 목록이다(이름·dockerfile·context). 비상 길만 dockerfile·context로 굽는다.
  imageWaitHint: 'https://github.com/sandcorporation/sandcorp-daypage/actions/workflows/release.yml',
  sourceUrl: 'https://github.com/sandcorporation/sandcorp-daypage',
  check: 'bash scripts/ci/check.sh',    // 비상 길(BUILD_ON=jenkins)에서만: 배포 스크립트 시험 + 백엔드·프론트·admin 시험을 도커 안에서. 실패하면 배포하지 않는다
  composeProject: 'daypage',
  composeFiles: ['docker-compose.prod.yml', 'docker-compose.oracle.yml'],
  deployScript: 'deploy/deploy.sh',
)
