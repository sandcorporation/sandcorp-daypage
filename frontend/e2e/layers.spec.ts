import { expect, test } from '@playwright/test'
import { Hands, openNote } from './helpers'

// #66 손잡이로 레이어 순서 바꾸기(터치)

test('#66 손잡이(⋮⋮)를 손가락으로 끌어 놓으면 레이어 순서가 바뀐다', async ({ page }) => {
  await openNote(page)
  const hands = await Hands.on(page)
  await page.getByRole('button', { name: '레이어', exact: true }).click()
  await page.getByRole('button', { name: '+ 새 레이어' }).click()
  const names = page.locator('.layer-row .layer-name')
  await expect(names).toHaveCount(2)
  const [top, bottom] = await names.allTextContents()

  const grip = (await page.locator('.layer-row .layer-grip').nth(1).boundingBox())!
  const first = (await page.locator('.layer-row').first().boundingBox())!
  await hands.fingerDrag(
    { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
    { x: grip.x + grip.width / 2, y: first.y + 4 },
    6,
  )
  await expect(names).toHaveText([bottom, top])
})
