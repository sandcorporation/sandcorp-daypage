import { expect, test } from '@playwright/test'
import { nextFrames, openNote } from './helpers'

// #170 새 페이지 시각: 키보드로 고르는 동안은 저장하지 않고, Enter로만 바꾼다

test('#170 화살표로 옮기는 동안 PATCH가 없고, Enter로 저장하면 초점이 단추로 돌아온다', async ({ page }) => {
  await openNote(page)
  const patches: (string | null)[] = []
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches.push(r.postData())
  })
  const trigger = page.getByRole('button', { name: /^새 페이지 \d/ })
  await expect(trigger).toHaveText('새 페이지 00:00')
  await trigger.press('Enter')
  const select = page.getByRole('combobox', { name: '새 페이지 시각' })
  await select.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(select).toHaveValue('2')
  expect(patches).toEqual([])

  await page.keyboard.press('Enter')
  await expect(trigger).toHaveText('새 페이지 02:00')
  await expect(trigger).toBeFocused()
  // #203 저장은 live 영역(Toast) 하나만 알린다. 새 장의 openedAt은 오늘 00:00이라 시각에 따라 보관 문구가 붙는다
  await expect(page.getByRole('status').filter({ hasText: '바꿨어요' })).toHaveText([/^새 페이지가 열리는 시각을 02:00로 바꿨어요/])
  await expect(page.getByRole('dialog', { name: '새 페이지 시각' })).toBeHidden()
  expect(patches).toEqual(['{"sealHour":2}'])

  // 새로 받아도(서버 저장) 그대로다. 화면 새로고침은 시험 시간 한도를 넘어 API로 읽는다
  const noteId = new URL(page.url()).pathname.split('/')[2]
  const saved = await page.context().request.get(`/api/notes/${noteId}`)
  expect(await saved.json()).toMatchObject({ sealHour: 2 })
})

// #208 바로 보관하면 함께 있던 사람에게 새 장이 열렸다고 알리고, 바꾼 주인은 저장 결과만 듣는다
test('#208 바로 보관: 함께 있던 사람은 새 페이지 알림을, 주인은 저장 결과만 받는다', async ({ page, browser, baseURL }) => {
  const hour = (new Date().getUTCHours() + 9) % 24
  test.skip(hour === 0, 'KST 0시대에는 지난 봉인 시각을 고를 수 없다')
  await openNote(page)
  const guestContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
  await guestContext.request.get('/auth/dev-login?kakao_id=9002&next=/api/me')
  const guest = await guestContext.newPage()
  await guest.goto(page.url())
  await expect(guest.getByText(/^참여 2 /)).toBeVisible()
  await expect(guest.getByText('실시간 연결됨 · 자동 저장')).toBeAttached()

  // 주인 화면의 알림 영역에 한 번이라도 뜬 글을 모은다
  await page.evaluate(() => {
    const heard: string[] = []
    Object.assign(window, { heard })
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[role="status"]')) heard.push(el.textContent ?? '')
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await page.getByRole('button', { name: /^새 페이지 \d/ }).press('Enter')
  const select = page.getByRole('combobox', { name: '새 페이지 시각' })
  await select.selectOption(String(hour))
  const reread = page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/notes\/[^/]+$/.test(r.url()))
  await select.press('Enter')

  await expect(guest.getByRole('status').filter({ hasText: '새 페이지가 열렸어요' })).toHaveCount(1)
  await expect(guest.getByRole('button', { name: '기록 보기' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '지금 페이지를 기록으로 옮겼어요' })).toBeVisible()
  await reread
  await nextFrames(page)
  expect(await page.evaluate(() => (window as unknown as { heard: string[] }).heard.filter((t) => t.includes('새 페이지가 열렸어요')))).toEqual([])
  await guestContext.close()
})
