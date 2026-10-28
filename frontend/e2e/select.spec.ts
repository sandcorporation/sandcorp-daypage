import { expect, test, type Page } from '@playwright/test'
import { Hands, frameScale, nextFrames, openNote, scrollTopOf, zoomIn, type Saved } from './helpers'

// #82 더해 고르기, #84 고른 것 손가락 끌기

/** 마우스로 획 하나와 글 상자 하나(펜을 쓰면 손가락은 스크롤만 하므로 펜은 쓰지 않는다). 선택 도구로 바꿔 둔다. */
async function strokeAndBox(page: Page, saved: Saved) {
  const hands = await Hands.on(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  await zoomIn(page)
  await hands.mouseStroke(Array.from({ length: 9 }, (_, i) => ({ x: vp.x + 150 + i * 12, y: vp.y + 150 + i * 5 })))
  await expect.poll(() => saved.strokes().length).toBe(1)
  await page.getByRole('button', { name: '글씨' }).click()
  await page.mouse.click(vp.x + 300, vp.y + 400)
  await page.keyboard.insertText('hello')
  await expect.poll(() => saved.boxes().length).toBe(1)
  await page.getByRole('button', { name: '선택·이동' }).click()
  return vp
}

const onStroke = (vp: { x: number; y: number }) => ({ x: vp.x + 198, y: vp.y + 170 })
const onBox = (vp: { x: number; y: number }) => ({ x: vp.x + 330, y: vp.y + 400 })

test('#82 더해 고르기: 켜면 탭으로 획과 글 상자를 섞어 고르고, 끄면 한 가지만 고른다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  // 선택 도구가 아닐 때는 보이지 않는다(펜 도구)
  const add = page.getByRole('button', { name: '더해 고르기' })
  await expect(add).toHaveCount(0)
  const vp = await strokeAndBox(page, saved)
  await expect(add).toBeVisible()
  await expect(add).toHaveAttribute('aria-pressed', 'false')

  // 꺼 둔 채로 획 → 글 상자: 마지막으로 탭한 것 하나만 고른다 → 끌면 글 상자만 간다
  const box = page.locator('.textbox')
  await hands.fingerTap(onStroke(vp))
  await nextFrames(page)
  await hands.fingerTap(onBox(vp))
  await expect(box).toHaveClass(/is-picked/)
  const y0 = saved.strokes()[0].points[1]
  const b0 = saved.boxes()[0].y
  await hands.fingerDrag(onBox(vp), { x: onBox(vp).x, y: onBox(vp).y + 40 }, 5)
  await expect.poll(() => saved.boxes()[0].y).toBeGreaterThan(b0 + 20)
  expect(saved.strokes()[0].points[1]).toBe(y0)

  // 켜고 획 → 글 상자: 둘 다 골라져 함께 옮겨진다
  await add.click()
  await expect(add).toHaveAttribute('aria-pressed', 'true')
  await hands.fingerTap(onStroke(vp))
  await nextFrames(page)
  await expect(box).toHaveClass(/is-picked/) // 이미 고른 글 상자는 그대로, 획이 더해진다
  const b1 = saved.boxes()[0].y
  await hands.fingerDrag(onStroke(vp), { x: onStroke(vp).x, y: onStroke(vp).y + 40 }, 5)
  await expect.poll(() => saved.strokes()[0].points[1]).toBeGreaterThan(y0 + 20)
  await expect.poll(() => saved.boxes()[0].y).toBeGreaterThan(b1 + 20)
})

test('#84 고른 묶음을 손가락으로 128px 이상 끌어도 끊기지 않고 옮겨지며, 빈 곳 끌기는 스크롤한다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  const vp = await strokeAndBox(page, saved)
  const scale = await frameScale(page)
  await page.getByRole('button', { name: '더해 고르기' }).click()
  await hands.fingerTap(onStroke(vp))
  await nextFrames(page)
  await hands.fingerTap(onBox(vp))
  await expect(page.locator('.textbox')).toHaveClass(/is-picked/)
  const y0 = saved.strokes()[0].points[1]
  const b0 = saved.boxes()[0].y
  const top = await scrollTopOf(page)

  // 8px씩 20번 = 160px(브라우저 스크롤이 손가락을 가져가면 몇 걸음 뒤 끊긴다)
  await hands.fingerDrag(onStroke(vp), { x: onStroke(vp).x, y: onStroke(vp).y + 160 }, 20)
  await expect.poll(() => saved.boxes()[0].y).toBeGreaterThan(b0 + 160 / scale - 4)
  const dy = saved.strokes()[0].points[1] - y0
  expect(dy).toBeGreaterThan(160 / scale - 4)
  // 놓는 자리는 격자에 맞춰질 수 있어(224 = 16×14) 위쪽은 한 칸 안으로 본다. 획과 글 상자는 같이 움직였다.
  expect(dy).toBeLessThan(160 / scale + 16)
  expect(Math.abs(saved.boxes()[0].y - b0 - dy)).toBeLessThan(1)
  expect(await scrollTopOf(page)).toBe(top)
})

test('#84 선택 도구에서 빈 곳 한 손가락 끌기는 종이를 스크롤하고 고른 것은 그대로다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  const vp = await strokeAndBox(page, saved)
  await hands.fingerTap(onStroke(vp))
  await nextFrames(page)
  const top = await scrollTopOf(page)
  const still = saved.strokes()[0].points[1]
  await hands.fingerDrag({ x: vp.x + 520, y: vp.y + 800 }, { x: vp.x + 520, y: vp.y + 500 }, 10)
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(top + 100)
  await nextFrames(page)
  expect(saved.strokes()[0].points[1]).toBe(still)
})
