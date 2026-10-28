import { defineConfig, devices } from '@playwright/test'

// 펜·터치 경로 e2e(#87). 실기기 없이 iPad 프리셋 + CDP 입력으로 실제 Chromium에서 돈다. 띄우는 법은 e2e/README.md.
const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8010)
const frontPort = Number(process.env.E2E_FRONT_PORT ?? 5183)
const db = process.env.E2E_POSTGRES_DB ?? 'daypage_e2e'

export default defineConfig({
  testDir: './e2e',
  // 시험 하나 3초(앞뒤 걸이 포함), 재시도 없음. 넘으면 한도를 올리지 않고 원인을 줄인다(test-speed-budget).
  timeout: 3_000,
  retries: 0,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${frontPort}`,
    browserName: 'chromium',
    trace: 'off',
    actionTimeout: 2_000,
  },
  projects: [
    { name: 'ipad', use: { ...devices['iPad Pro 11'], browserName: 'chromium' }, testIgnore: /desktop\.spec/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testMatch: /desktop\.spec/ },
  ],
  webServer: [
    {
      command: 'bash e2e/backend.sh',
      url: `http://127.0.0.1:${backendPort}/api/client-config`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { E2E_POSTGRES_DB: db, E2E_BACKEND_PORT: String(backendPort), E2E_FRONT_PORT: String(frontPort) },
    },
    {
      // 운영과 같은 번들로 시험한다(개발 서버는 모듈을 낱낱이 받아 첫 화면이 느려 시험 한도를 먹는다). 산출물은 dist가 아니라 dist-e2e.
      command: `pnpm exec vite build --outDir dist-e2e --emptyOutDir && pnpm exec vite preview --outDir dist-e2e --port ${frontPort} --strictPort`,
      url: `http://127.0.0.1:${frontPort}/`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { BACKEND_URL: `http://127.0.0.1:${backendPort}` },
    },
  ],
})
