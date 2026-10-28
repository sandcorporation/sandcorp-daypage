import { expect, test } from '@playwright/test'
import { openNote } from './helpers'

// #82 더해 고르기는 터치 기기에서만 보인다(마우스 기기에서는 shift+누르기를 쓴다)

test('#82 마우스 기기에서는 더해 고르기·손가락 단추가 보이지 않는다', async ({ page }) => {
  await openNote(page)
  await page.getByRole('button', { name: '선택·이동' }).click()
  await expect(page.getByRole('group', { name: '손가락·화면' })).toBeHidden()
  await expect(page.getByRole('button', { name: '더해 고르기' })).toBeHidden()
})
