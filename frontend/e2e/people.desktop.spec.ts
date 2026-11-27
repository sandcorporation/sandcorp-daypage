import { expect, test, type Locator, type Page } from '@playwright/test'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { fakePeers, nextFrames, openNote } from './helpers'

// #220 「+N」 뒤에 가린 사람까지, 함께 있는 사람 전부의 닉네임을 모든 폭에서 볼 수 있다

const NAMES = Array.from({ length: 4 }, (_, i) => `푸른 펭귄${i}`)

const headerAndPage = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('.page-frame')!.getBoundingClientRect()
    return { x: r.x, y: r.y, header: document.querySelector<HTMLElement>('.note-header')!.offsetHeight }
  })

for (const size of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
]) {
  // 1280에서는 얼굴 6개라 「+N」이 서려면 7명이 넘어야 한다
  const others = size.width >= 1280 ? 8 : 4
  test(`#220 ${size.width} 폭에서 ${others + 1}명: 「+N」을 눌러 모두 보고, 머리글과 지면은 그대로다`, async ({ page }) => {
    await page.setViewportSize(size)
    const setPeers = await fakePeers(page)
    await openNote(page)
    await setPeers(others)
    await nextFrames(page)
    const before = await headerAndPage(page)

    await page.getByRole('button', { name: `함께 있는 사람 ${others + 1}명 — 목록 보기` }).click()
    const list = page.getByRole('dialog', { name: `함께 있는 사람 ${others + 1}명` })
    await expect(list.getByRole('listitem')).toHaveCount(others + 1)
    await expect(list.getByRole('listitem').first()).toContainText('(나)')
    for (const name of NAMES) await expect(list.getByText(name, { exact: true })).toBeInViewport({ ratio: 1 })
    await nextFrames(page)
    expect(await headerAndPage(page)).toEqual(before)
    if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/220-list-${others + 1}-${size.width}x${size.height}.png` })
    // 1280에서도 5명 사진을 남긴다: 얼굴이 다 보여 「+N」이 없어도 목록은 열린 채 따라 바뀐다
    if (others > 4) {
      await setPeers(4)
      await expect(page.getByRole('dialog', { name: '함께 있는 사람 5명' }).getByRole('listitem')).toHaveCount(5)
      await page.keyboard.press('Escape')
      if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/220-faces-5-${size.width}x${size.height}.png` })
    }
  })
}

test('#220 768 폭: 키보드로 열고 Esc로 닫으면 단추로 돌아오고, 지면을 눌러 닫아도 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  const setPeers = await fakePeers(page)
  await openNote(page)
  await setPeers(4)
  const button = page.getByRole('button', { name: '함께 있는 사람 5명 — 목록 보기' })
  const list = page.getByRole('dialog', { name: '함께 있는 사람 5명' })
  // Space는 키보드(Tab)로 초점이 온 단추만 받는다(그 밖에는 지면 끌기, #200)
  await button.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key)
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(button).toBeFocused()
  }
  await button.click()
  await page.locator('.page-viewport').click({ position: { x: 40, y: 300 } })
  await expect(list).toBeHidden()
  await expect(button).toBeFocused()
})

// #246 「+N」이 없는 2명에서도 터치와 키보드로 이름을 본다
const shot = async (page: Page, name: string) => {
  if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/246-${name}.png` })
}

async function twoPeople(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  const setPeers = await fakePeers(page)
  await openNote(page)
  await setPeers(1)
  await nextFrames(page)
  return {
    button: page.getByRole('button', { name: '함께 있는 사람 2명 — 목록 보기' }),
    list: page.getByRole('dialog', { name: '함께 있는 사람 2명' }),
  }
}

async function expectBothNames(list: Locator) {
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByRole('listitem').first()).toContainText('(나)')
  await expect(list.getByText(NAMES[0], { exact: true })).toBeInViewport({ ratio: 1 })
}

/** 단추의 크기와, 그 네 가장자리 안쪽을 짚으면 단추가 잡히는지(다른 것에 덮이지 않았는지) */
const touchTarget = (button: Locator) =>
  button.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const spots = [[r.left + 4, r.y + r.height / 2], [r.right - 4, r.y + r.height / 2], [r.x + r.width / 2, r.top + 2], [r.x + r.width / 2, r.bottom - 2]]
    return { width: r.width, height: r.height, reachable: spots.every(([x, y]) => el.contains(document.elementFromPoint(x, y))) }
  })

test.describe('#246 터치', () => {
  test.use({ hasTouch: true })
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    test(`#246 ${width} 터치: 얼굴을 누르면 두 사람 이름이 보인다`, async ({ page }) => {
      const { button, list } = await twoPeople(page, width, height)
      const target = await touchTarget(button)
      expect(target.width).toBeGreaterThanOrEqual(44)
      expect(target.height).toBeGreaterThanOrEqual(44)
      expect(target.reachable).toBe(true)
      const before = await headerAndPage(page)
      await shot(page, `faces-${width}x${height}`)
      await button.locator('.avatar').last().tap()
      await expectBothNames(list)
      await nextFrames(page)
      expect(await headerAndPage(page)).toEqual(before)
      await shot(page, `list-${width}x${height}`)
    })
  }
})

test('#246 1280 키보드: Tab으로 얼굴에 와 Enter로 열고, Esc로 닫으면 초점이 돌아온다', async ({ page }) => {
  const { button, list } = await twoPeople(page, 1280, 800)
  await page.getByRole('button', { name: /^노트 이름 바꾸기/ }).focus()
  await page.keyboard.press('Tab')
  await expect(button).toBeFocused()
  await shot(page, 'focus-1280x800')
  await page.keyboard.press('Enter')
  await expectBothNames(list)
  await shot(page, 'list-1280x800')
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(button).toBeFocused()
})

const MESSAGE_NOTE_INFO = 105 // src/note/useRealtime.ts

/** 서버가 보낸 note_info의 참여 수·정원을 바꾼다. 다른 메시지는 그대로 둔다. */
function withMemberCount(message: Buffer, memberCount: number): Buffer {
  const decoder = decoding.createDecoder(new Uint8Array(message))
  if (decoding.readVarUint(decoder) !== MESSAGE_NOTE_INFO) return message
  const info = JSON.parse(decoding.readVarString(decoder)) as object
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_NOTE_INFO)
  encoding.writeVarString(encoder, JSON.stringify({ ...info, memberCount, memberLimit: null }))
  return Buffer.from(encoding.toUint8Array(encoder))
}

// #220 「참여 N명」 배지의 자릿수가 바뀌어도 머리글 줄은 그대로다
for (const width of [390, 768, 1024, 1280]) {
  test(`#220 ${width} 폭: 참여 인원이 9명이든 10명이든 배지 폭과 머리글 높이가 같다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    let memberCount = 9
    // 머리말은 REST로 한 번, 웹소켓에 연결하면 note_info로 한 번 더 온다(#222). 둘 다 같은 수로 바꾼다.
    await page.routeWebSocket(/\/ws\/notes\//, (ws) => {
      const server = ws.connectToServer()
      server.onMessage((message) => ws.send(typeof message === 'string' ? message : withMemberCount(message, memberCount)))
    })
    await page.route(/\/api\/notes\/[^/]+$/, async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, json: { ...((await res.json()) as object), memberCount, memberLimit: null } })
    })
    await openNote(page)
    const measure = async () => {
      const badge = page.getByRole('button', { name: `참여 ${memberCount}명`, exact: true })
      await expect(badge).toBeVisible()
      await nextFrames(page)
      return { badge: (await badge.boundingBox())!.width, ...(await headerAndPage(page)) }
    }
    const nine = await measure()
    memberCount = 10
    await page.reload()
    expect(await measure()).toEqual(nine)
  })
}
