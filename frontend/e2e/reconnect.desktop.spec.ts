import { expect, test, type Browser, type Page } from '@playwright/test'
import { openNote } from './helpers'

// #230 연결이 끊겼다 이어진 사람이 다른 사람의 「함께 있는 사람」에 몇 초 안에 돌아온다.
// 옛 연결은 서버가 끊긴 줄 모른 채 남는다(반쯤 열림). 20초 오프라인은 남의 화면 시계를 30초 넘겨 흉내 낸다
// (y-protocols는 30초 동안 소식이 없는 사람을 뺀다).

/** A(`page`)가 보는 노트에 B(`other`)가 들어온다. `cut`은 B의 망을 끊고 `restore`는 다시 잇는다. */
async function withDroppable(page: Page, browser: Browser, baseURL: string | undefined) {
  await page.clock.install()
  await openNote(page)
  const noteId = new URL(page.url()).pathname.split('/')[2]

  const context = await browser.newContext({ baseURL })
  const other = await context.newPage()
  await other.clock.install()
  // 오프라인 동안 오가는 것을 끊고, 화면이 닫은 옛 연결은 서버에 알리지 않는다(서버 쪽은 열린 채 남는다).
  let offline = false
  let connections = 0
  await other.routeWebSocket(/\/ws\/notes\//, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => !offline && server.send(m))
    server.onMessage((m) => !offline && ws.send(m))
    ws.onClose(() => {})
    server.onClose(() => {})
    connections++
  })
  await context.request.get('/auth/dev-login?kakao_id=9002&next=/api/me')
  await other.goto(`/note/${noteId}`)
  await other.locator('.page-frame').waitFor()
  const people = (n: number) => page.getByRole('group', { name: `함께 있는 사람 ${n}명` })
  await expect(people(2)).toBeVisible()

  /** B가 끊기고, A의 시계로 30초 넘게 지나 A의 목록에서 빠질 때까지 */
  const cut = async () => {
    await context.setOffline(true)
    offline = true
    await expect(other.getByText('오프라인 · 이 탭에서 다시 연결되면 맞춰져요')).toBeVisible()
    await page.clock.runFor(33_000)
    await expect(people(1)).toBeVisible()
  }
  const restore = async () => {
    offline = false
    await context.setOffline(false)
    await expect.poll(() => connections).toBe(2)
  }
  return { context, other, people, cut, restore }
}

test('#230 오프라인이었다 다시 연결되면, 옛 연결이 남아 있어도 다른 사람 목록에 곧 돌아온다', async ({ page, browser, baseURL }) => {
  const { context, people, cut, restore } = await withDroppable(page, browser, baseURL)
  await cut()
  await restore()
  await expect(people(2)).toBeVisible({ timeout: 1_500 })
  await context.close()
})

test('#240 글 상자를 고치는 중에 끊겼다 이어지면, 다른 사람 화면에 「이어 쓰는 중」이 다시 뜬다', async ({ page, browser, baseURL }) => {
  const { context, other, cut, restore } = await withDroppable(page, browser, baseURL)
  await other.getByRole('button', { name: '글씨' }).click()
  const viewport = (await other.locator('.page-viewport').boundingBox())!
  await other.mouse.click(viewport.x + 200, viewport.y + 200)
  await other.keyboard.insertText('이어')
  const editing = page.getByText(/이어 쓰는 중$/)
  await expect(editing).toBeVisible()

  await cut()
  await expect(editing).toBeHidden()
  await restore()
  // 초점은 상자에 그대로라 B는 아무것도 누르지 않는다
  await expect(editing).toBeVisible({ timeout: 1_500 })
  await context.close()
})

test('#242 빈 글 상자를 만든 채 끊겼다 이어져도 상자가 남고, 이어 친 글이 들어간다', async ({ page, browser, baseURL }) => {
  const { context, other, restore } = await withDroppable(page, browser, baseURL)
  // 들어올 때의 남은 빈 상자 정리(동기화 1.5초 뒤)를 먼저 지나 보낸다
  await other.clock.runFor(2_000)
  await other.getByRole('button', { name: '글씨' }).click()
  const viewport = (await other.locator('.page-viewport').boundingBox())!
  await other.mouse.click(viewport.x + 200, viewport.y + 200)
  const box = other.getByRole('textbox', { name: '글 상자' })
  await expect(box).toBeFocused()

  await context.setOffline(true)
  await expect(other.getByText('오프라인 · 이 탭에서 다시 연결되면 맞춰져요')).toBeVisible()
  await other.clock.runFor(5_000)
  await restore()
  await expect(other.getByText('오프라인 · 이 탭에서 다시 연결되면 맞춰져요')).toBeHidden()
  await other.clock.runFor(3_000)

  await expect(box).toBeFocused()
  await other.keyboard.type('rv')
  await expect(box).toHaveText('rv')
  await expect(page.locator('.page-frame')).toContainText('rv')
  await context.close()
})
