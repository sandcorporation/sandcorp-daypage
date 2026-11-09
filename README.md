# Daypage

링크 하나로 여러 사람이 같은 장에 실시간으로 그리고 쓰는 하루 노트. 용어는 [CONTEXT.md](CONTEXT.md)를 따른다.

## 로컬 실행

필요한 것: Docker, [uv](https://docs.astral.sh/uv/), Node 22+, pnpm

```bash
cp .env.example .env            # 카카오 키 채우기
docker compose up -d            # Postgres, Redis

cd backend
uv sync
uv run python manage.py migrate
uv run uvicorn config.asgi:application --reload --port 8000

cd frontend                     # 다른 터미널
pnpm install
pnpm dev                        # http://localhost:5173
```

자정 봉인 작업(Celery)은 필요할 때만 띄운다. 매시 정각에 지난 장을 봉인하고 접속자에게 새 장을 알린다.

```bash
cd backend
uv run celery -A config worker --pool=solo -l info   # Windows는 --pool=solo
uv run celery -A config beat -l info
uv run python manage.py seal_pages                  # 손으로 한 번 돌리기
```

Vite 개발 서버가 `/api`, `/auth`, `/ws`를 Django(8000)로 프록시하므로 브라우저에서는 5173 하나만 쓴다.

## 테스트

로컬에서 돌린 뒤 PR을 연다. PR 검사(GitHub Actions `.github/workflows/pr-check.yml`)가 job으로 나눠 돌리고(+ 배포 스크립트 시험 `bash deploy/deploy_test.sh`), main 병합 뒤에는 `release.yml`이 같은 검사·이미지 빌드(병렬) → `production` 승격을 밟는다(`docs/ops/offhost-build.md`). `bash scripts/ci/check.sh`는 같은 검사를 도커 안에서 한 번에 돌린다(Jenkins 비상 길). 백엔드 테스트는 `docker compose`의 Postgres를 쓴다.

```bash
cd backend && uv run pytest
cd frontend && pnpm typecheck && pnpm test
```

## 운영 배포

`docker-compose.prod.yml`이 Caddy(HTTPS·WSS, 정적 파일) + Uvicorn(Django) + Celery worker·beat + Postgres + Redis를 띄운다.

1. DNS에서 `daypage.sandcorp.co.kr`의 A 레코드를 서버로 향하게 하고 80·443 포트를 연다.
2. 서버의 저장소 루트에 `.env`를 만든다(`.env.example`의 운영 항목 참고: `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `KAKAO_*`, `PUBLIC_ORIGIN`, `POSTGRES_PASSWORD`).
3. 배포 스크립트로 띄운다(처음과 이후 배포 모두 같다). Jenkins도 이 스크립트를 부른다.

```bash
COMPOSE_FILE=docker-compose.prod.yml bash deploy/deploy.sh
docker compose -f docker-compose.prod.yml logs -f backend
```

배포는 무중단이다. migrate를 먼저 따로 돌리고, backend·backend2를 하나씩 바꾸며(앞의 것이 헬스를 통과한 뒤 다음 것), 그동안 Caddy가 살아 있는 쪽으로 다시 보낸다. 프론트는 빌드 결과를 `web_static` 볼륨에 넣고 `index.html`만 바꿔 끼우며, Caddy는 내리지 않고 설정만 reload한다. 그래서 마이그레이션은 옛 코드와 새 코드가 잠깐 함께 돌아도 되게 짠다(열을 지우거나 이름을 바꿀 때는 두 번의 배포로 나눈다).

- 데이터: `pgdata`(DB), `caddy_data`(인증서), `web_static`(정적 파일) 볼륨에 남는다. 재시작·재배포해도 유지된다.
- Caddy가 `/api/*`, `/auth/*`, `/ws/*`는 Django로, 나머지는 SPA(`index.html` fallback)로 보낸다.
- 로컬에서 운영 구성을 시험할 때는 `SITE_ADDRESS=:80`, `HTTP_PORT=8088`처럼 HTTP로 띄우고 `ENV_FILE`로 env 파일을 바꿀 수 있다.
