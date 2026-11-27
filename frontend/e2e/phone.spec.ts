import { expect, test, type Locator, type Page } from '@playwright/test'
import { openNote } from './helpers'

// #172 폰 너비(390px) 터치: 아래 단추들이 겹치지 않고, 이름 입력칸과 참여 팝오버가 화면 안에 보인다

test.use({ viewport: { width: 390, height: 844 } })

/** 화면 안에 온전히 있고, 가운데와 네 귀퉁이 안쪽을 눌렀을 때 자기 자신이 맞는(다른 것에 덮이지 않은) 상태인지. 아니면 까닭을 돌려준다. */
function blockedBy(target: Locator) {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return `화면 밖 ${Math.round(r.left)}..${Math.round(r.right)}`
    const dx = r.width / 2 - 6
    const dy = r.height / 2 - 6
    for (const [x, y] of [[0, 0], [-dx, 0], [dx, 0], [0, -dy], [0, dy]]) {
      const hit = document.elementFromPoint(r.left + r.width / 2 + x, r.top + r.height / 2 + y)
      if (!hit || !el.contains(hit)) return `덮임: ${hit?.getAttribute('aria-label') ?? hit?.className}`
    }
    return ''
  })
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= 390)

test('#172 아래 단추들이 모두 화면 안에 있고 서로 덮지 않는다', async ({ page }) => {
  await openNote(page)
  // 선택 도구에서는 손가락·화면 묶음에 '더해 고르기'가 더해져 가장 넓다
  await page.getByRole('button', { name: '선택·이동' }).click()
  const buttons = page.locator('.status-corner button:visible, .view-dock button:visible:enabled')
  for (const button of await buttons.all()) {
    expect.soft(await blockedBy(button), (await button.getAttribute('aria-label')) ?? '').toBe('')
  }
  await page.getByRole('button', { name: '기능 건의' }).tap()
  await expect(page.getByRole('dialog', { name: '기능 건의' })).toBeVisible()
  expect(await noSideScroll(page)).toBe(true)
})

test('#172 이름 입력칸이 보이고 머리말 팝오버가 화면 안에 있다', async ({ page }) => {
  await openNote(page)
  await page.getByRole('button', { name: /^노트 이름 바꾸기/ }).click()
  const input = page.getByRole('textbox', { name: '노트 이름' })
  expect(await blockedBy(input)).toBe('')
  expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(200)
  await input.press('Escape')

  for (const [opener, dialog] of [[/^참여 /, '참여자와 정원'], [/^매일 |:00/, '새 페이지 시각']] as const) {
    const button = page.locator('.note-header').getByRole('button', { name: opener })
    await button.click()
    const pop = page.getByRole('dialog', { name: dialog })
    const box = (await pop.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    if (dialog === '참여자와 정원') expect(await blockedBy(pop.getByRole('button', { name: '이 노트 삭제' }))).toBe('')
    await button.click()
  }
  expect(await noSideScroll(page)).toBe(true)
})
