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

CI 없이 로컬에서만 돌린다. 백엔드 테스트는 `docker compose`의 Postgres를 쓴다.

```bash
cd backend && uv run pytest
cd frontend && pnpm typecheck && pnpm test
```

## 운영 배포

`docker-compose.prod.yml`이 Caddy(HTTPS·WSS, 정적 파일) + Uvicorn(Django) + Celery worker·beat + Postgres + Redis를 띄운다.

1. DNS에서 `daypage.sandcorp.co.kr`의 A 레코드를 서버로 향하게 하고 80·443 포트를 연다.
2. 서버의 저장소 루트에 `.env`를 만든다(`.env.example`의 운영 항목 참고: `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `KAKAO_*`, `PUBLIC_ORIGIN`, `POSTGRES_PASSWORD`).
3. 띄운다. 마이그레이션은 backend 컨테이너가 시작할 때 자동으로 돈다.

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f backend
```

- 데이터: `pgdata`(DB), `caddy_data`(인증서) 볼륨에 남는다. 재시작·재배포해도 유지된다.
- Caddy가 `/api/*`, `/auth/*`, `/ws/*`는 Django로, 나머지는 SPA(`index.html` fallback)로 보낸다.
- 로컬에서 운영 구성을 시험할 때는 `SITE_ADDRESS=:80`, `HTTP_PORT=8088`처럼 HTTP로 띄우고 `ENV_FILE`로 env 파일을 바꿀 수 있다.
