import { expect, request, test } from '@playwright/test'
import { fakePeers, openNote } from './helpers'

// #182 정원은 저장으로만 바뀌고, 참여자 내보내기는 초점을 잃지 않는다.
// 화살표 입력과, 단추가 disabled가 되면 초점이 빠지는 동작은 실제 브라우저에서만 보인다.

test('#182 정원은 Enter로만 저장하고, 내보내기 확인은 초점을 지닌 채 Esc로 거둔다', async ({ page, baseURL }) => {
  await openNote(page) // 정원 2
  const noteId = new URL(page.url()).pathname.split('/')[2]
  const guest = await request.newContext({ baseURL })
  await guest.get('/auth/dev-login?kakao_id=9002&next=/api/me')

  const patches: (string | null)[] = []
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches.push(r.postData())
  })
  const badge = page.getByRole('button', { name: /^참여 / })
  const dialog = page.getByRole('dialog', { name: '참여자와 정원' })
  // #190 창을 열어 둔 사이에 들어온 사람이 목록에도 나온다
  await badge.click()
  await expect(dialog.getByText('참여자 1명')).toBeVisible()
  expect((await guest.get(`/api/notes/${noteId}`)).ok()).toBe(true)
  await guest.dispose()
  await expect(dialog.getByText('참여자 2명')).toBeVisible()
  await badge.click()
  await expect(dialog).toBeHidden()
  await badge.press('Enter')
  const select = dialog.getByRole('combobox', { name: /정원/ })
  await select.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(select).toHaveValue('4')
  await expect(select).toBeFocused()
  expect(patches).toEqual([])
  await page.keyboard.press('Enter')
  await expect(badge).toHaveText(/\/ 4명$/)
  await expect(badge).toBeFocused()
  await expect(dialog).toBeHidden()
  expect(patches).toEqual(['{"memberLimit":4}'])

  await badge.press('Enter')
  const kick = dialog.getByRole('button', { name: /(?<!확인) 내보내기$/ })
  const confirm = dialog.getByRole('button', { name: / 내보내기 확인$/ })
  await kick.press('Enter')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(kick).toBeFocused()
  await expect(dialog).toBeVisible()

  await kick.press('Enter')
  await confirm.press('Enter')
  await expect(dialog.getByRole('button', { name: / 다시 허용$/ })).toBeVisible()
  await expect(dialog.getByText('참여자 1명')).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: /님을 내보냈어요$/ })).toBeAttached()
  // #197 다시 허용한 뒤 초점은 「내보낸 사람」 제목에 간다
  await dialog.getByRole('button', { name: / 다시 허용$/ }).press('Enter')
  await expect(dialog.getByText('내보낸 사람이 없어요.')).toBeVisible()
  await expect(dialog.getByText('내보낸 사람', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(badge).toBeFocused()

  // #190 지우고 홈으로 오면 알린다
  await badge.press('Enter')
  await dialog.getByRole('button', { name: '이 노트 삭제' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click()
  await expect(page.getByRole('status').filter({ hasText: /노트를 지웠어요$/ })).toBeVisible()
})

// #236 낮은 화면(200% 확대)이나 사람이 많을 때도 머리글 펼침 창은 화면 안에 들어오고, 넘치면 창 안에서 스크롤된다

/** 단추의 위·아래 끝이 모두 눌리는 자리인가(화면 밖이거나 떠 있는 막대에 덮이면 false) */
const reachable = (el: Element) => {
  const r = el.getBoundingClientRect()
  return [r.top + 3, r.bottom - 3].every((y) => el.contains(document.elementFromPoint(r.x + r.width / 2, y)))
}

// 640×400은 720px 아래 규칙, 800×450은 그 위 규칙을 탄다
for (const size of [
  { width: 640, height: 400 },
  { width: 800, height: 450 },
]) {
  test(`#236 ${size.width}×${size.height} 참여자·내보낸 사람이 여럿이어도 창 안에서 스크롤해 「이 노트 삭제」를 누른다`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(size)
    await openNote(page)
    const noteId = new URL(page.url()).pathname.split('/')[2]
    const csrf = (await page.context().cookies()).find((c) => c.name === 'csrftoken')!.value
    const headers = { 'X-CSRFToken': csrf }
    await page.request.patch(`/api/notes/${noteId}`, { data: { memberLimit: null }, headers })
    await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        const guest = await request.newContext({ baseURL })
        await guest.get(`/auth/dev-login?kakao_id=${9360 + i}&next=/api/me`)
        await guest.get(`/api/notes/${noteId}`)
        await guest.dispose()
      }),
    )
    const res = await page.request.get(`/api/notes/${noteId}/members`)
    const { members } = (await res.json()) as { members: { id: number; isOwner: boolean }[] }
    for (const m of members.filter((m) => !m.isOwner).slice(0, 2))
      await page.request.post(`/api/notes/${noteId}/members/${m.id}/kick`, { headers })

    await page.getByRole('button', { name: /^참여 / }).click()
    const dialog = page.getByRole('dialog', { name: '참여자와 정원' })
    await expect(dialog.getByRole('button', { name: / 다시 허용$/ })).toHaveCount(2)
    const box = (await dialog.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(size.height)

    // 휠로 창 안을 내리면 맨 아래 단추가 온전히 보인다
    const remove = dialog.getByRole('button', { name: '이 노트 삭제' })
    await page.mouse.move(box.x + 8, box.y + 100)
    await page.mouse.wheel(0, 2000)
    await expect(remove).toBeInViewport({ ratio: 1 })
    await expect.poll(() => remove.evaluate(reachable)).toBe(true)

    // Tab으로 가도 보이는 곳으로 오고, 노트 화면은 밀리지 않는다. 모든 단추가 눌리는 자리에 온다
    await dialog.evaluate((el) => el.scrollTo(0, 0))
    await dialog.getByRole('combobox', { name: /정원/ }).focus()
    const buttons = await dialog.getByRole('button').count()
    for (let i = 0; i < buttons; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(`(${reachable})(document.activeElement)`)).toBe(true)
    }
    await expect(remove).toBeFocused()
    expect(await page.locator('.note-screen').evaluate((el) => el.scrollTop)).toBe(0)
    if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/after-members-end-${size.width}x${size.height}.png` })
    await remove.click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
  })
}

test('#236 800×340 「새 페이지 시각」 창과 「+N」 목록도 화면 안에 들어오고 끝까지 닿는다', async ({ page }) => {
  const size = { width: 800, height: 340 }
  await page.setViewportSize(size)
  const setPeers = await fakePeers(page)
  await openNote(page)
  await setPeers(12)
  const inside = async (name: string | RegExp) => {
    const box = (await page.getByRole('dialog', { name }).boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(size.height)
  }

  await page.getByRole('button', { name: /목록 보기$/ }).click()
  await inside(/^함께 있는 사람/)
  const last = page.getByRole('dialog').getByRole('listitem').last()
  await last.scrollIntoViewIfNeeded()
  expect(await last.evaluate(reachable)).toBe(true)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /^새 페이지 \d/ }).click()
  await inside('새 페이지 시각')
  const save = page.getByRole('dialog').getByRole('button', { name: '저장' })
  await save.focus()
  expect(await save.evaluate(reachable)).toBe(true)
  expect(await page.locator('.note-screen').evaluate((el) => el.scrollTop)).toBe(0)
})
