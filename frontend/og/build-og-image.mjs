// og/og-image.svg -> public/og-image.png (1200x630). 사용: node og/build-og-image.mjs
// playwright-core 가 필요하다(저장소 의존성이 아님). 경로는 PLAYWRIGHT_DIR(playwright-core 가 든 node_modules 의 부모)로 준다.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const require = createRequire((process.env.PLAYWRIGHT_DIR ?? process.cwd()) + '/')
const { chromium } = require('playwright-core')

const svg = readFileSync(here('./og-image.svg'), 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`)
  writeFileSync(here('../public/og-image.png'), await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } }))
} finally {
  await browser.close()
}
