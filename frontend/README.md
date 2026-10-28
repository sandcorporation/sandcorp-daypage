# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## e2e: 펜·터치 경로 (Playwright)

실기기(iPad·펜슬·S펜)가 없어서, 펜·손가락 경로를 실제 Chromium에서 에뮬레이션으로 덮는다(#87). iPad Pro 11 프리셋(터치·모바일)에 CDP `Input.dispatchMouseEvent`(`pointerType: 'pen'`, `force`)로 펜을, `Input.dispatchTouchEvent`로 손가락을 보낸다. 시험은 `e2e/*.spec.ts`, 입력·저장 읽기 도우미는 `e2e/helpers.ts`. 저장된 획·글 상자는 브라우저가 웹소켓으로 보낸 Yjs 갱신을 엿보아 읽는다.

```bash
cd frontend
pnpm e2e                                   # 백엔드(8010)와 프론트 번들(5183)을 알아서 띄우고 돈다
E2E_POSTGRES_DB=daypage_e2e_mine pnpm e2e  # 시험 DB 이름을 따로 줄 때(기본 daypage_e2e)
```

- 필요한 것: `docker compose up -d`의 Postgres·Redis, uv, 그리고 Playwright 브라우저 한 번 `pnpm exec playwright install chromium`(저장소 밖 `~/.cache/ms-playwright`에 받는다. `pnpm install`은 브라우저를 받지 않으므로 운영 Docker 빌드에는 영향이 없다).
- 백엔드는 `e2e/backend.sh`가 띄운다: `DJANGO_DEV_LOGIN=1`, 시험 DB `E2E_POSTGRES_DB`(없으면 만든다)와 Redis 9번 DB만 쓴다. 운영·공유 DB는 쓰지 않는다. 프런트는 `dist-e2e`로 따로 빌드해 `vite preview`로 띄운다(`dist`와 무관, 개발 서버보다 첫 화면이 빨라 시험 한도에 맞는다). 이미 떠 있는 서버가 있으면 그대로 쓴다.
- 포트: `E2E_BACKEND_PORT`(8010), `E2E_FRONT_PORT`(5183), 동시 작업자 수 `E2E_WORKERS`(2).
- 시험 하나는 앞뒤 걸이 포함 **3초**, 재시도 없음(`playwright.config.ts`). 한도를 올리지 않고 준비를 줄인다(로그인·노트 만들기는 API로, CDP 입력은 한꺼번에 보낸다). 고정 대기(`waitForTimeout`·`setTimeout`)는 oxlint가 막는다(`.oxlintrc.json`의 `e2e/**`). 느린 시험은 `test-results/report.json`(시험마다 `duration`)이나 `pnpm e2e --reporter=list`로 본다.
- 끝나고 시험 DB를 지울 때: `uv run python -c "import psycopg;psycopg.connect('dbname=postgres user=daypage password=daypage host=127.0.0.1',autocommit=True).execute('DROP DATABASE daypage_e2e')"`(backend에서).
