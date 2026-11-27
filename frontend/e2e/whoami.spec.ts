import { expect, test } from '@playwright/test'
import { openNote } from './helpers'

// #203 폰 터치 화면에서도 자기 닉네임이 보이고, 아바타의 접근 이름이 닉네임이다

test.use({ viewport: { width: 390, height: 844 } })

test('#203 390 폭에서 자기 닉네임이 잘리지 않고 보인다', async ({ page }) => {
  await openNote(page)
  const noteId = new URL(page.url()).pathname.split('/')[2]
  const { me } = (await (await page.context().request.get(`/api/notes/${noteId}`)).json()) as { me: { nickname: string } }

  const mine = page.locator('.note-header').getByText(`나: ${me.nickname}`)
  await expect(mine).toBeInViewport({ ratio: 1 })
  // 말줄임·가림 없이 온전히 보인다
  const shown = await mine.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const line = el.parentElement!.getBoundingClientRect()
    const hit = document.elementFromPoint(r.right - 2, r.top + r.height / 2)
    return r.left >= line.left && r.right <= line.right && el.contains(hit)
  })
  expect(shown).toBe(true)
  await expect(page.getByRole('img', { name: `${me.nickname}(나)` })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true)
})
