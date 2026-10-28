import { expect, test } from '@playwright/test'
import { Hands, nextFrames, openNote, scrollTopOf, zoomIn, zoomPercent } from './helpers'

// #34 핀치 확대·두 손가락 스크롤

test('#34 두 손가락 벌리기로 배율이 커지고 손을 떼면 그 값에 머문다', async ({ page }) => {
  await openNote(page)
  const hands = await Hands.on(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  const before = await zoomPercent(page)
  await hands.pinch({ x: vp.x + vp.width / 2, y: vp.y + vp.height / 2 }, 100, 300, 10)
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before)
  // 손을 뗀 뒤에도 그 배율에 머문다(맞춤으로 돌아가지 않는다)
  const after = await zoomPercent(page)
  await nextFrames(page)
  expect(await zoomPercent(page)).toBe(after)
  await expect(page.getByRole('button', { name: '화면에 맞추기' })).toHaveAttribute('aria-pressed', 'false')
})

test('#34 두 손가락 나란히 끌기는 확대 없이 종이를 스크롤한다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  await zoomIn(page)
  const zoom = await zoomPercent(page)
  const top = await scrollTopOf(page)
  await hands.twoFingerDrag({ x: vp.x + vp.width / 2, y: vp.y + 700 }, { x: 0, y: -300 })
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(top + 100)
  expect(await zoomPercent(page)).toBe(zoom)
  expect(saved.strokes()).toHaveLength(0)
})
