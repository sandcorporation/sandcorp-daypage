import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import * as encoding from 'lib0/encoding'
import { nextFrames, openNote, zoomIn } from './helpers'

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

/** 도구 막대·곡선 막대·보기 칸·아래 칩의 단추 가운데 화면 밖이거나 다른 것에 덮여 누를 수 없는 것. 옆으로 밀어 보는 막대(휴대폰)의 단추는 밀어 놓고 본다. */
const unpressable = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.toolbar button, .curve-bar button, .view-dock button, .status-corner button')]
      .filter((b) => b.getClientRects().length > 0)
      .flatMap((b) => {
        const bar = b.closest<HTMLElement>('.toolbar')
        if (bar && bar.scrollWidth > bar.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const r = b.getBoundingClientRect()
        const name = b.getAttribute('aria-label') ?? b.textContent
        if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return [`${name}: 화면 밖`]
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (hit?.closest('button') === b) return []
        return [`${name}: ${hit?.closest('button')?.getAttribute('aria-label') ?? hit?.className}에 덮임`]
      }),
  )

// #216 떠 있는 것의 자리 표: 모드 × 막대 자리 × 폭. 보기 칸이 가장 넓은 터치 기기로 본다.
test.describe('#216', () => {
  test.use({ hasTouch: true })
  for (const mode of ['보통', '집중']) {
    for (const [dock, dockName] of [['left', '왼쪽'], ['bottom', '아래']]) {
      for (const size of [
        { width: 360, height: 740 },
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1280, height: 800 },
      ]) {
        test(`#216 ${mode} 모드 ${dockName} 막대 ${size.width}×${size.height}: 곡선 중 모든 단추가 화면 안에서 눌린다`, async ({ page }) => {
          await page.setViewportSize(size)
          await page.route('**/api/client-config', async (route) => {
            const res = await route.fetch()
            await route.fulfill({ response: res, json: { ...((await res.json()) as object), photos: true } })
          })
          await page.addInitScript((d) => localStorage.setItem('daypage:toolbar-dock', d), dock)
          await openNote(page)
          await expect(page.getByRole('button', { name: '사진', exact: true })).toBeVisible()
          if (mode === '집중') await page.getByRole('button', { name: '집중 모드' }).click()
          await startCurve(page)
          await expect(page.getByRole('button', { name: '화면 고정' })).toBeVisible()
          if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/216-${mode === '집중' ? 'focus' : 'normal'}-${dock}-${size.width}x${size.height}.png` })
          await expect.poll(() => overlaps(page), { timeout: 1_000 }).toEqual([])
          expect(await unpressable(page)).toEqual([])
          // 휴대폰의 막대는 화면 폭을 다 쓴다(좁게 눌려 몇 단추만 보이지 않게)
          if (size.width <= 720) expect((await page.locator('.toolbar').boundingBox())!.width).toBeGreaterThan(size.width - 40)
        })
      }
    }
  }
})

/**
 * 접속자(presence)를 서버 없이 더하고 뺀다. 웹소켓을 그대로 서버에 잇고, 화면 쪽으로 awareness 메시지를 끼워 넣는다.
 * openNote보다 먼저 부른다.
 */
async function fakePeers(page: Page) {
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket(/\/ws\/notes\//, (ws) => {
    ws.connectToServer()
    socket = ws
  })
  let clock = 0
  let shown = 0
  return async (others: number) => {
    const update = encoding.createEncoder()
    const count = Math.max(others, shown)
    clock++
    encoding.writeVarUint(update, count)
    for (let i = 0; i < count; i++) {
      encoding.writeVarUint(update, 1000 + i)
      encoding.writeVarUint(update, clock)
      encoding.writeVarString(update, JSON.stringify(i < others ? { nickname: `푸른 펭귄${i}`, color: '#5E6270' } : null))
    }
    shown = others
    const message = encoding.createEncoder()
    encoding.writeVarUint(message, 1) // MESSAGE_AWARENESS
    encoding.writeVarUint8Array(message, encoding.toUint8Array(update))
    socket!.send(Buffer.from(encoding.toUint8Array(message)))
    await expect(page.getByRole('group', { name: `함께 있는 사람 ${others + 1}명` })).toBeVisible()
  }
}

// #218 그리는 중에 사람이 들고 나도 지면은 움직이지 않는다
for (const size of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
]) {
  test(`#218 ${size.width}×${size.height} 접속자가 1→3→5→9→1로 바뀌어도 지면은 그대로다`, async ({ page }) => {
    await page.setViewportSize(size)
    const setPeers = await fakePeers(page)
    await openNote(page)
    await expect(page.getByRole('button', { name: /^참여 / })).toBeVisible()
    const where = () =>
      page.evaluate(() => {
        const r = document.querySelector('.page-frame')!.getBoundingClientRect()
        return { x: r.x, y: r.y, header: document.querySelector<HTMLElement>('.note-header')!.offsetHeight }
      })
    await nextFrames(page)
    const before = await where()
    for (const total of [3, 5, 9, 1]) {
      await setPeers(total - 1)
      await nextFrames(page)
      expect({ total, ...(await where()) }).toEqual({ total, ...before })
      if (process.env.E2E_SHOT_DIR && total <= 5) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/218-peers${total}-${size.width}x${size.height}.png` })
    }
  })
}

/** 지면을 네 방향 끝까지 스크롤해 가며, 모서리 안쪽과 가장자리 가운데를 짚었을 때 지면이 아닌 것이 잡히는 곳 */
const hiddenSpots = (page: Page) =>
  page.evaluate(() => {
    const vp = document.querySelector<HTMLElement>('.page-viewport')!
    const frame = document.querySelector<HTMLElement>('.page-frame')!
    const inset = 8
    const out: string[] = []
    for (const [v, top] of [['위', 0], ['아래', 1e6]] as const) {
      for (const [h, left] of [['왼쪽', 0], ['오른쪽', 1e6]] as const) {
        vp.scrollTo(left, top)
        const r = frame.getBoundingClientRect()
        const box = vp.getBoundingClientRect()
        // 지면이 화면보다 크면 가장자리 가운데는 보이는 부분의 가운데다
        const midX = (Math.max(r.left, box.left) + Math.min(r.right, box.right)) / 2
        const midY = (Math.max(r.top, box.top) + Math.min(r.bottom, box.bottom)) / 2
        const x = left ? r.right - inset : r.left + inset
        const y = top ? r.bottom - inset : r.top + inset
        for (const [name, px, py] of [[`${v} ${h} 모서리`, x, y], [`${v} 가장자리`, midX, y], [`${h} 가장자리`, x, midY]] as const) {
          const hit = document.elementFromPoint(px, py)
          if (!hit || !frame.contains(hit)) out.push(`${name}: ${hit?.closest('[aria-label]')?.getAttribute('aria-label') ?? hit?.className ?? '화면 밖'}`)
        }
      }
    }
    return [...new Set(out)]
  })

// #218 떠 있는 것 밑의 지면은 스크롤해서 꺼내 그릴 수 있다. 집중 모드에서는 네 자리의 막대가 모두 지면 위에 뜬다
for (const mode of ['보통', '집중']) {
  for (const [dock, dockName] of [['left', '왼쪽'], ['bottom', '아래'], ...(mode === '집중' ? [['right', '오른쪽'], ['top', '위']] : [])]) {
    for (const size of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
    ]) {
      test(`#218 ${mode} 모드 ${dockName} 막대 ${size.width}×${size.height}: 지면 끝까지 스크롤하면 모서리·가장자리가 가리지 않는다`, async ({ page }) => {
        await page.setViewportSize(size)
        await page.addInitScript((d) => localStorage.setItem('daypage:toolbar-dock', d), dock)
        await openNote(page)
        if (mode === '집중') await page.getByRole('button', { name: '집중 모드' }).click()
        const name = `${mode === '집중' ? 'focus' : 'normal'}-${dock}-${size.width}x${size.height}`
        // 「화면에 맞추기」에서는 옆으로 넘치지 않는다
        await expect.poll(() => page.locator('.page-viewport').evaluate((el) => el.scrollWidth - el.clientWidth), { timeout: 1_000 }).toBe(0)
        await expect.poll(() => hiddenSpots(page), { timeout: 1_000 }).toEqual([])
        if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/218-end-${name}.png` })
        await page.locator('.page-viewport').evaluate((el) => el.scrollTo(0, 0))
        await startCurve(page)
        await expect.poll(() => hiddenSpots(page), { timeout: 1_000 }).toEqual([])
        if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/218-end-curve-${name}.png` })
        // 지면이 화면보다 클 때도 같다
        await zoomIn(page, 3)
        await expect.poll(() => hiddenSpots(page), { timeout: 1_000 }).toEqual([])
      })
    }
  }
}
