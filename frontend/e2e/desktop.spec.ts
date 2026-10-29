import { expect, test } from '@playwright/test'
import { openNote } from './helpers'

// #82 더해 고르기는 터치 기기에서만 보인다(마우스 기기에서는 shift+누르기를 쓴다)

test('#82 마우스 기기에서는 더해 고르기·손가락 단추가 보이지 않는다', async ({ page }) => {
  await openNote(page)
  await page.getByRole('button', { name: '선택·이동' }).click()
  await expect(page.getByRole('group', { name: '손가락·화면' })).toBeHidden()
  await expect(page.getByRole('button', { name: '더해 고르기' })).toBeHidden()
})

// #89 보기 돌리기·뒤집기: 데스크톱 단축키 경로

const matrixOf = (page: import('@playwright/test').Page) =>
  page.locator('.page-stage').evaluate((el) => getComputedStyle(el).transform)

test('#89 R·Shift+R·M·Shift+0 단축키와 버튼, 90도에서 맞춤 배율·스크롤 상자 재계산, 글 입력 중 무시', async ({ page }) => {
  await openNote(page)
  const requests: string[] = []
  page.on('request', (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`))
  const storageBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  const frame = page.locator('.page-frame')
  const viewport = page.locator('.page-viewport')

  const box0 = (await frame.boundingBox())!
  expect(box0.height / box0.width).toBeCloseTo(1.5, 2)

  await page.keyboard.press('r') // 시계 방향 90도: 가로·세로가 바뀐다
  await expect.poll(() => matrixOf(page)).toBe('matrix(0, 1, -1, 0, ' + Math.round((await frame.boundingBox())!.width) + ', 0)')
  const box1 = (await frame.boundingBox())!
  expect(box1.width / box1.height).toBeCloseTo(1.5, 2)
  // 맞춤 배율을 다시 계산했다: 보이는 폭에 들어오고 가로 스크롤이 없다
  const fits = await viewport.evaluate((el) => ({ over: el.scrollWidth - el.clientWidth, w: el.clientWidth }))
  expect(fits.over).toBeLessThanOrEqual(0)
  expect(box1.width).toBeLessThanOrEqual(fits.w)

  await page.keyboard.press('Shift+R') // 반시계: 원위치
  await expect.poll(() => matrixOf(page)).toBe('none')
  await page.keyboard.press('Shift+R') // 270도
  await expect.poll(async () => (await frame.boundingBox())!.width > (await frame.boundingBox())!.height).toBe(true)
  await page.keyboard.press('m')
  await page.keyboard.press('Shift+0')
  await expect.poll(() => matrixOf(page)).toBe('none')
  await page.keyboard.press('0') // 화면에 맞추기는 그대로 동작한다
  await expect(page.getByRole('button', { name: '화면에 맞추기' })).toHaveAttribute('aria-pressed', 'true')

  // 버튼: 돌리면 원위치 버튼이 강조된다
  const reset = page.getByRole('button', { name: '돌리기·뒤집기 원위치' })
  await expect(reset).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: '시계 방향으로 돌리기', exact: true }).click()
  await expect(reset).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '좌우 뒤집기', exact: true }).click()
  await expect(page.getByRole('button', { name: '좌우 뒤집기', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await reset.click()
  await expect.poll(() => matrixOf(page)).toBe('none')

  // 돌리기·뒤집기만으로는 서버 요청도 저장소 쓰기도 없다
  expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([])
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(storageBefore)

  // 글 입력 중에는 무시한다
  await page.getByRole('button', { name: '글씨' }).click()
  const vp = (await viewport.boundingBox())!
  await page.mouse.click(vp.x + 200, vp.y + 200)
  await page.keyboard.insertText('r')
  await page.keyboard.press('m')
  expect(await matrixOf(page)).toBe('none')
})

test('#89 폰 폭 390px: 돌리기 버튼이 화면 안에 있고 가로로 넘치지 않으며 다른 버튼과 겹치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openNote(page)
  await page.keyboard.press('r')
  const m = await page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
    const r = rect('.rotate-control')
    const z = rect('.zoom-control')
    const s = rect('.status-corner')
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    return {
      docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vpOver: document.querySelector('.page-viewport')!.scrollWidth - document.querySelector('.page-viewport')!.clientWidth,
      inside: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      overlapZoom: hit(r, z),
      overlapStatus: hit(r, s),
    }
  })
  expect(m.docOver).toBeLessThanOrEqual(0)
  expect(m.vpOver).toBeLessThanOrEqual(0)
  expect(m.inside).toBe(true)
  expect(m.overlapZoom).toBe(false)
  expect(m.overlapStatus).toBe(false)
})
