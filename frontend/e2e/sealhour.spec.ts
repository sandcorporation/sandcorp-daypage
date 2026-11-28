import { expect, test, type Page } from '@playwright/test'
import { nextFrames, openNote, savedStrokes } from './helpers'

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

/** 지금부터 live 영역에 새로 나가는 글을 차례대로 모은다(낭독기가 듣는 순서) */
function listen(page: Page) {
  return page.evaluate(() => {
    const said: string[] = []
    Object.assign(window, { said })
    const regions = () => document.querySelectorAll('[role="status"], [aria-live]')
    const last = new Map<Element, string>()
    regions().forEach((el) => last.set(el, el.textContent ?? ''))
    new MutationObserver(() => {
      for (const el of regions()) {
        const text = el.textContent ?? ''
        if (text && text !== last.get(el)) said.push(text)
        last.set(el, text)
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
}
const said = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said)

/** 다음에 여는 웹소켓이 서버의 문서(sync step 2)를 받을 때까지 */
async function nextSync(page: Page) {
  const ws = await page.waitForEvent('websocket', (w) => w.url().includes('/ws/notes/'))
  await ws.waitForEvent('framereceived', ({ payload }) => typeof payload !== 'string' && payload[0] === 0 && payload[1] === 1)
}

// #208 바로 보관하면 함께 있던 사람에게 새 장이 열렸다고 알리고, 바꾼 주인은 저장 결과만 듣는다
// #212 장이 바뀌는 동안 연결 알약은 그대로라, 낭독기에 나가는 글은 그것 하나다. 빈 장은 기록에 남지 않는다고 말한다
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

  await expect(page.getByText('실시간 연결됨 · 자동 저장')).toBeAttached()

  await page.getByRole('button', { name: /^새 페이지 \d/ }).press('Enter')
  const select = page.getByRole('combobox', { name: '새 페이지 시각' })
  await select.selectOption(String(hour))
  await listen(page)
  await listen(guest)
  const synced = Promise.all([nextSync(page), nextSync(guest)])
  await select.press('Enter')
  await synced
  await nextFrames(page)
  await nextFrames(guest)

  await expect.poll(() => said(guest)).toEqual(['새 페이지가 열렸어요. 만든 사람이 새 페이지 시각을 바꿨어요'])
  expect(await said(page)).toEqual([expect.stringMatching(/바꿨어요\. 빈 페이지라 기록에는 남지 않아요$/)])
  for (const screen of [page, guest]) await expect(screen.getByText('실시간 연결됨 · 자동 저장')).toBeAttached()
  await expect(guest.getByRole('link', { name: '기록', exact: true })).toBeVisible()
  await guestContext.close()
})

// #280 선택 도구로 획을 끄는 중(놓기 전)에 장이 넘어가면 그 옮기기는 어느 장에도 남지 않는다
test('#280 획을 끌던 중에 장이 넘어가면 저장되지 않았다고 알리고 단추는 그 장의 기록을 연다', async ({ page }) => {
  const hour = (new Date().getUTCHours() + 9) % 24
  test.skip(hour === 0, 'KST 0시대에는 지난 봉인 시각을 고를 수 없다')
  const saved = await openNote(page)
  const box = (await page.locator('.page-frame').boundingBox())!
  await page.mouse.move(box.x + 60, box.y + 60)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 60, { steps: 4 })
  await page.mouse.up()
  await savedStrokes(page, saved, 1)
  await page.getByRole('button', { name: /^선택·이동/ }).click()
  await page.mouse.move(box.x + 130, box.y + 60)
  await page.mouse.down()
  await page.mouse.move(box.x + 130, box.y + 160, { steps: 4 })

  // 만든 사람의 다른 창에서 바꾼 것처럼 API로 바꾼다
  const noteId = new URL(page.url()).pathname.split('/')[2]
  const csrf = (await page.context().cookies()).find((c) => c.name === 'csrftoken')?.value ?? ''
  await page.context().request.patch(`/api/notes/${noteId}`, { data: { sealHour: hour }, headers: { 'X-CSRFToken': csrf, Referer: page.url() } })
  await expect(page.locator('.toast')).toHaveText(/장이 바뀌는 순간 1개는 저장되지 않았어요/)
  await page.mouse.up()
  await page.getByRole('button', { name: '지난 페이지 보기' }).click()
  await expect(page).toHaveURL(new RegExp(`/note/${noteId}/history/\\d{4}-\\d{2}-\\d{2}`))
})
