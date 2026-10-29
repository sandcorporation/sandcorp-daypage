import { expect, test, type Page } from '@playwright/test'
import { Hands, nextFrames, openNote, penEraserStroke, savedStrokes, zoomIn, type Pt } from './helpers'

// #95 범위·올가미 지우개, 펜 지우개 버튼

/** 펜으로 가로 획 하나를 긋고 그 자리(화면 좌표)를 돌려준다 */
async function oneLine(page: Page) {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  await zoomIn(page)
  const y = vp.y + 250
  const path: Pt[] = Array.from({ length: 13 }, (_, i) => ({ x: vp.x + 150 + i * 20, y }))
  await hands.penStroke(path)
  await savedStrokes(page, saved, 1)
  return { saved, hands, vp, y, mid: vp.x + 270 }
}

const across = (x: number, y: number): Pt[] => Array.from({ length: 7 }, (_, i) => ({ x, y: y - 60 + i * 20 }))

test('#95 범위 지우개: 획 가운데를 지나가면 지나간 부분만 지워져 두 조각이 남는다', async ({ page }) => {
  const { saved, hands, y, mid } = await oneLine(page)
  await page.keyboard.press('e')
  await hands.penStroke(across(mid, y))
  const pieces = await savedStrokes(page, saved, 2)
  // 두 조각은 지우개 자리를 사이에 두고 왼쪽·오른쪽에 있다
  const xs = pieces.map((s) => s.points.filter((_, i) => i % 3 === 0))
  const [left, right] = xs.sort((a, b) => a[0] - b[0])
  expect(Math.max(...left)).toBeLessThan(Math.min(...right))
})

test('#95 올가미 지우개: 둘러싼 영역 안의 획을 지운다', async ({ page }) => {
  const { saved, hands, vp, y } = await oneLine(page)
  await page.keyboard.press('e')
  await page.getByRole('button', { name: /^지우개 크기/ }).click()
  await page.getByRole('radio', { name: /^올가미/ }).click()
  await page.keyboard.press('Escape')
  const loop: Pt[] = [
    { x: vp.x + 100, y: y - 80 },
    { x: vp.x + 500, y: y - 80 },
    { x: vp.x + 500, y: y + 80 },
    { x: vp.x + 100, y: y + 80 },
    { x: vp.x + 100, y: y - 70 },
  ]
  await hands.penStroke(loop)
  await savedStrokes(page, saved, 0)
})

test('#95 펜 지우개 버튼(button 5, buttons 32): 펜 도구 그대로 지우고, 떼면 다시 펜으로 그린다', async ({ page }) => {
  const { saved, hands, vp, y, mid } = await oneLine(page)
  await penEraserStroke(page, across(mid, y))
  await savedStrokes(page, saved, 2)
  await expect(page.getByRole('button', { name: /^펜/ }).first()).toHaveAttribute('aria-pressed', 'true')
  await nextFrames(page)
  await hands.penStroke([0, 1, 2, 3].map((i) => ({ x: vp.x + 150 + i * 20, y: vp.y + 450 })))
  await savedStrokes(page, saved, 3)
})
