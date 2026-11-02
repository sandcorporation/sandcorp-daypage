// main 배포 — 파이프라인은 Jenkins 공용 라이브러리 sandcorp(sandcorporation/jenkins-shared)의 sandcorpDeploy에 있다.
// 여기에는 이 저장소가 넘기는 값만 둔다. 동작(작업 브랜치 push 무시·이미 배포한 sha 건너뜀·배포 전 검사·mac 우선 빌드·
// oracle pull 배포·실패 시 자동 롤백·디스코드 알림)과 인자 목록은 jenkins-shared README, 이 저장소 사정은 docs/ops/offhost-build.md.
//
// 배포 순서는 라이브러리 것이 아니라 deploy/deploy.sh(무중단: migrate → backend·backend2 하나씩 → 정적 파일 → Caddy reload
// → worker·beat → 헬스)다(deployScript). 실패하면 라이브러리가 직전 성공 sha 이미지로 같은 스크립트를 SANDCORP_ROLLBACK=1로
// 다시 부르고, 스크립트는 그때 migrate를 건너뛰고 같은 순서로 되돌린다. 시험: deploy/deploy_test.sh.
@Library('sandcorp@js-7') _

sandcorpDeploy(
  name: 'Daypage',
  images: [
    [repo: 'ghcr.io/sandcorporation/daypage-backend', envVar: 'DAYPAGE_BACKEND_IMAGE', dockerfile: 'backend/Dockerfile', context: 'backend'],
    [repo: 'ghcr.io/sandcorporation/daypage-web-dist', envVar: 'DAYPAGE_WEB_DIST_IMAGE', dockerfile: 'deploy/web.Dockerfile', context: '.'],
  ],
  sourceUrl: 'https://github.com/sandcorporation/daypasge',   // 저장소 이름이 daypasge다(오타 아님)
  check: 'bash scripts/ci/check.sh',    // 배포 스크립트 시험 + 백엔드·프론트·admin 시험을 도커 안에서. 실패하면 굽지도 배포하지도 않는다
  composeProject: 'daypage',
  composeFiles: ['docker-compose.prod.yml', 'docker-compose.oracle.yml'],
  deployScript: 'deploy/deploy.sh',
)
