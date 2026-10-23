/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { metricsSnippet } from './metricsSnippet.js'

const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'

export default defineConfig(({ mode }) => ({
  plugins: [react(), metricsSnippet(loadEnv(mode, process.cwd(), 'VITE_').VITE_METRICS_SNIPPET_URL)],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/auth': { target: backend, changeOrigin: false },
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
}))
