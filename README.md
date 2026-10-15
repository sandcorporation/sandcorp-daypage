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
