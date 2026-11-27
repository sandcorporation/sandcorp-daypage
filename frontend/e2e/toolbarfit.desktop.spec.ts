import { expect, test, type Page } from '@playwright/test'
import { openNote } from './helpers'

// #207 흔한 노트북 창에서 세로 도구 막대가 화면을 넘거나 아래 칩(연결·배율)에 깔리지 않는다

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
]

/** 가운데를 짚었을 때 그 단추가 아닌 것이 잡히는 단추들의 이름. 옆으로 밀어 보는 막대(휴대폰)에서 막대 밖에 있는 단추는 뺀다. */
const covered = (page: Page, bar: '도구' | '곡선' = '도구') =>
  page.getByRole(bar === '도구' ? 'navigation' : 'toolbar', { name: bar }).evaluate((nav) =>
    [...nav.querySelectorAll('button')]
      .filter((b) => {
        const r = b.getBoundingClientRect()
        const box = nav.getBoundingClientRect()
        const x = r.left + r.width / 2
        if (x < box.left || x > box.right) return false
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') !== b
      })
      .map((b) => b.getAttribute('aria-label')),
  )

/** 떠 있는 것(도구 막대, 아래 왼쪽·오른쪽 칩, 곡선 막대) 가운데 서로 겹치는 짝 */
const overlaps = (page: Page) =>
  page.evaluate(() => {
    const items = [...document.querySelectorAll('.toolbar, .status-corner > *, .view-dock > *, .curve-bar')]
      .map((el) => ({ name: el.getAttribute('aria-label') ?? el.className, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
    return items.flatMap((a, i) =>
      items
        .slice(i + 1)
        .filter((b) => a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom)
        .map((b) => `${a.name} × ${b.name}`),
    )
  })

/** 도형 도구에서 곡선을 고르고 첫 점을 찍어 곡선 막대를 띄운다 */
async function startCurve(page: Page) {
  await page.getByRole('button', { name: /^도형/ }).click()
  await page.getByRole('button', { name: /^도형/ }).click()
  await page.getByRole('dialog', { name: '도형' }).getByRole('button', { name: /곡선/ }).click()
  const frame = await page.locator('.page-viewport').boundingBox()
  await page.mouse.click(frame!.x + frame!.width / 2, frame!.y + 200)
  await expect(page.locator('.curve-bar')).toBeVisible()
}

for (const size of SIZES) {
  for (const tool of ['펜', '글씨']) {
    test(`#207 ${size.width}×${size.height} ${tool} 도구: 막대의 모든 단추를 누를 수 있고 떠 있는 칩과 겹치지 않는다`, async ({ page }) => {
      await page.setViewportSize(size)
      // 사진 저장소가 있는 서버처럼 「사진」 단추까지 있는 가장 긴 막대로 본다
      await page.route('**/api/client-config', async (route) => {
        const res = await route.fetch()
        await route.fulfill({ response: res, json: { ...((await res.json()) as object), photos: true } })
      })
      await openNote(page)
      await expect(page.getByRole('button', { name: '사진', exact: true })).toBeVisible()
      if (tool === '글씨') {
        await page.getByRole('button', { name: '글씨', exact: true }).click()
        await expect(page.getByRole('button', { name: /^글꼴/ })).toBeVisible()
      }
      expect(await covered(page)).toEqual([])
      expect(await overlaps(page)).toEqual([])
      // 오른쪽에 붙여도 오른쪽 아래 배율 칩에 깔리지 않는다
      await page.getByRole('button', { name: '도구 막대 옮기기' }).press('ArrowRight')
      await expect(page.locator('.toolbar')).toHaveAttribute('data-dock', 'right')
      expect(await covered(page)).toEqual([])
      expect(await overlaps(page)).toEqual([])
    })
  }
}

test('#207 곡선 막대는 아래 칩과도, 아래에 붙인 도구 막대와도 겹치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openNote(page)
  await startCurve(page)
  expect(await overlaps(page)).toEqual([])
  await page.getByRole('button', { name: '도구 막대 옮기기' }).press('ArrowDown')
  await expect(page.locator('.toolbar')).toHaveAttribute('data-dock', 'bottom')
  expect(await overlaps(page)).toEqual([])
})

test('#207 좁은 창에서 위·아래에 붙인 막대는 줄을 바꿔 모든 단추를 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 721, height: 800 })
  await page.route('**/api/client-config', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...((await res.json()) as object), photos: true } })
  })
  await openNote(page)
  await expect(page.getByRole('button', { name: '사진', exact: true })).toBeVisible()
  for (const [key, dock] of [['ArrowUp', 'top'], ['ArrowDown', 'bottom']]) {
    await page.getByRole('button', { name: '도구 막대 옮기기' }).press(key)
    await expect(page.locator('.toolbar')).toHaveAttribute('data-dock', dock)
    expect(await covered(page)).toEqual([])
    expect(await overlaps(page)).toEqual([])
  }
})

// #214 아래 막대가 한 줄이든 두 줄이든 곡선 막대는 그 위에 뜬다
for (const size of [
  { width: 768, height: 1024 },
  { width: 721, height: 900 },
  { width: 800, height: 1280 },
  { width: 1023, height: 900 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`#214 ${size.width}×${size.height} 아래 막대로 곡선을 그리는 동안 도구 막대와 곡선 막대의 모든 단추를 누를 수 있다`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.route('**/api/client-config', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, json: { ...((await res.json()) as object), photos: true } })
    })
    // 휴대폰에는 옮기기 손잡이가 없어, 넓은 화면에서 골라 둔 자리를 저장해 둔다
    await page.addInitScript(() => localStorage.setItem('daypage:toolbar-dock', 'bottom'))
    await openNote(page)
    await expect(page.getByRole('button', { name: '사진', exact: true })).toBeVisible()
    await startCurve(page)
    expect(await covered(page)).toEqual([])
    expect(await covered(page, '곡선')).toEqual([])
    expect(await overlaps(page)).toEqual([])
    if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/curve-${size.width}x${size.height}.png` })
  })
}

// 집중 모드의 아래 막대는 휴대폰 폭에서도 아래에 뜬다
for (const size of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test(`#214 ${size.width}×${size.height} 집중 모드 아래 막대에서도 곡선 막대는 막대·배율 칩과 겹치지 않는다`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.addInitScript(() => localStorage.setItem('daypage:toolbar-dock', 'bottom'))
    await openNote(page)
    await page.getByRole('button', { name: '집중 모드' }).click()
    await startCurve(page)
    expect(await covered(page)).toEqual([])
    expect(await covered(page, '곡선')).toEqual([])
    expect(await overlaps(page)).toEqual([])
  })
}
