// main에 푸시하면 oracle(Jenkins 에이전트, arm64)에 배포한다.
//
// .env는 여기서 만들지 않는다. 워크스페이스에 놓아 둔 것을 compose가 ./.env로 읽는다.
// 저장소에는 없고(.gitignore), checkout은 추적하지 않는 파일을 지우지 않아 빌드 사이에 남는다.
// oracle 호스트에서는 /var/jenkins_home/workspace/daypage/.env 에 둔다.
//
// oracle에 배포한 것이 운영(prod)이다. oracle의 80·443은 NPMplus가 쓰므로 Caddy는 docker 브리지
// 게이트웨이 172.17.0.1:${HTTP_PORT}(기본 18090)에만 묶는다.
// NPMplus 프록시 호스트: daypage.sandcorp.co.kr → http://172.17.0.1:18090, 웹소켓 허용, Let's Encrypt.
//
// 테스트는 로컬에서만 돌린다(CI 없음). 이 잡은 빌드·배포·헬스 확인만 한다.

pipeline {
  agent { label 'oracle' }

  options {
    // 배포가 겹치면 컨테이너를 서로 갈아끼우게 된다.
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
    timestamps()
  }

  environment {
    COMPOSE_PROJECT_NAME = 'daypage'
    COMPOSE_FILE = 'docker-compose.prod.yml:docker-compose.oracle.yml'
    DOCKER_BUILDKIT = '1'
  }

  triggers {
    githubPush()
  }

  stages {
    stage('체크아웃') {
      steps {
        checkout scm
        sh 'git log --oneline -1'
      }
    }

    stage('빌드·배포') {
      steps {
        sh 'bash deploy/deploy.sh'
      }
    }
  }

  post {
    // 빌드가 끝나면 디스코드로 결과 한 줄을 보낸다. 모든 Sandcorp 제품이 같은 웹훅을 쓰므로
    // 메시지의 [Daypage] 표식으로 제품을 구분한다(형식은 제품 공통).
    //
    // 웹훅 주소는 저장소에 두지 않는다 — Jenkins 자격증명(Secret text) discord-deploy-webhook을
    // 이름으로만 부른다. 그 값을 아는 사람은 채널에 아무 말이나 올릴 수 있다.
    //
    // 알림이 실패해도 빌드 결과를 뒤집지 않는다 — catchError와 curl 끝의 `|| true`가 그 역할이다.
    // 본문은 JSON이라 따옴표·역슬래시가 깨지기 쉬우니 파일로 써서 넘겨 셸이 다시 해석하지 않게 한다.
    always {
      script {
        catchError(buildResult: null, stageResult: null, message: '디스코드 알림 실패 — 배포 결과와 무관하다') {
          withCredentials([string(credentialsId: 'discord-deploy-webhook', variable: 'DISCORD_WEBHOOK')]) {
            def result = currentBuild.currentResult
            def mark = result == 'SUCCESS' ? '✅' : (result == 'ABORTED' ? '⚪' : '❌')
            def sha = (env.GIT_COMMIT ?: '').take(12)
            def took = currentBuild.durationString.replace(' and counting', '')
            def text = "${mark} [Daypage] 배포 ${result} — #${env.BUILD_NUMBER}" +
              (sha ? " (${sha})" : '') + " · ${took} · ${env.BUILD_URL}"
            writeFile file: 'discord-payload.json', text: groovy.json.JsonOutput.toJson([content: text])
            sh 'curl -sS -X POST -H "Content-Type: application/json" --data @discord-payload.json "$DISCORD_WEBHOOK" > /dev/null || true'
          }
        }
      }
    }
    failure {
      echo '배포 실패 — deploy/deploy.sh 출력과 compose 로그를 보라. 이전 컨테이너는 up -d가 실패한 서비스만 남는다.'
    }
  }
}
