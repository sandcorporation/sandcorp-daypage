import { expect, test, type Page } from '@playwright/test'
import { Hands, nextFrames, openNote, zoomIn, zoomPercent, type Pt, type Saved } from './helpers'

// #89 보기 돌리기(90도)·좌우 뒤집기: 어느 상태에서도 입력이 손끝 자리에 맞고, 저장되는 점은 원래 장 좌표다.

/** 화면에 실제로 걸린 변환(CSS)과 배율. 시험의 기대값은 구현의 계산이 아니라 브라우저가 그린 행렬에서 얻는다. */
async function stageInfo(page: Page) {
  return page.locator('.page-stage').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform)
    const frame = el.parentElement!.getBoundingClientRect()
    return { matrix: [m.a, m.b, m.c, m.d, m.e, m.f], scale: (el as HTMLElement).offsetWidth / 1600, left: frame.left, top: frame.top, width: frame.width, height: frame.height }
  })
}

/** 화면 한 점이 가리키는 장 좌표(보이는 행렬의 역행렬) */
async function pageAt(page: Page, p: Pt): Promise<Pt> {
  const s = await stageInfo(page)
  const [a, b, c, d, e, f] = s.matrix
  const x = p.x - s.left - e
  const y = p.y - s.top - f
  const det = a * d - b * c
  return { x: (d * x - c * y) / det / s.scale, y: (-b * x + a * y) / det / s.scale }
}

/** 보이는 상자 안의 비율 위치(0~1)를 화면 좌표로 */
async function onScreen(page: Page, fx: number, fy: number): Promise<Pt> {
  const s = await stageInfo(page)
  return { x: s.left + s.width * fx, y: s.top + s.height * fy }
}

const newest = (saved: Saved, seen: Set<string>) => {
  const s = saved.strokes().filter((x) => !seen.has(x.id))
  s.forEach((x) => seen.add(x.id))
  return s
}

/** 상태를 하나씩 바꿔 가며 같은 손짓으로 긋고, 저장된 처음·끝 점이 손끝의 장 좌표와 같은지 본다. 네 번 돌리면 8가지 중 4가지(거울 여부는 호출자가 정한다). */
async function drawInFourRotations(page: Page, saved: Saved, draw: (path: Pt[]) => Promise<void>) {
  const seen = new Set<string>()
  const states: string[] = []
  for (let i = 0; i < 4; i++) {
    const a = await onScreen(page, 0.3, 0.25)
    const path = Array.from({ length: 9 }, (_, k) => ({ x: a.x + k * 10, y: a.y + k * 6 }))
    await draw(path)
    await expect.poll(() => saved.strokes().length, { timeout: 2_000 }).toBe(i + 1)
    const [stroke] = newest(saved, seen)
    const first = await pageAt(page, path[0])
    const last = await pageAt(page, path[path.length - 1])
    const pts = stroke.points
    expect(Math.abs(pts[0] - first.x)).toBeLessThan(8)
    expect(Math.abs(pts[1] - first.y)).toBeLessThan(8)
    expect(Math.abs(pts[pts.length - 3] - last.x)).toBeLessThan(8)
    expect(Math.abs(pts[pts.length - 2] - last.y)).toBeLessThan(8)
    states.push((await stageInfo(page)).matrix.join(','))
    await page.keyboard.press('r')
    await nextFrames(page)
  }
  // 네 번 모두 다른 방향이었다
  expect(new Set(states).size).toBe(4)
}

test('#89 펜: 돌리기 4가지에서 획의 저장 좌표가 손끝의 장 좌표와 같다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  await drawInFourRotations(page, saved, (path) => hands.penStroke(path.map((p) => ({ ...p, force: 0.5 }))))
})

test('#89 펜: 좌우 뒤집은 채 돌리기 4가지에서도 같다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  await page.keyboard.press('m')
  await drawInFourRotations(page, saved, (path) => hands.penStroke(path.map((p) => ({ ...p, force: 0.5 }))))
})

test('#89 손가락: 돌리기 4가지에서 손가락 획이 손끝 자리에 그어진다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  await drawInFourRotations(page, saved, (path) => hands.fingerDrag(path[0], path[path.length - 1], 4))
})

test('#89 새로고침하면 돌리기·뒤집기가 원위치로 돌아온다', async ({ page }) => {
  await openNote(page)
  await page.keyboard.press('r')
  await page.keyboard.press('m')
  await nextFrames(page)
  expect((await stageInfo(page)).matrix.join(',')).not.toBe('1,0,0,1,0,0')
  await page.reload()
  await page.locator('.page-frame').waitFor()
  expect((await stageInfo(page)).matrix.join(',')).toBe('1,0,0,1,0,0')
})

test('#89 마우스·지우개·글 상자·선택이동: 90도+거울 상태에서도 손끝 자리에 맞는다', async ({ page }) => {
  // 이 시험의 지우개는 획을 통째로 지우는 획 지우개로(기본은 #95부터 범위 지우개)
  await page.addInitScript(() => localStorage.setItem('daypage:tool-prefs', JSON.stringify({ eraserMode: 'stroke' })))
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  await page.keyboard.press('r')
  await page.keyboard.press('m')
  await nextFrames(page)
  const a = await onScreen(page, 0.3, 0.3)
  const path = Array.from({ length: 9 }, (_, k) => ({ x: a.x + k * 10, y: a.y + k * 6 }))

  // 마우스로 긋기
  await hands.mouseStroke(path)
  await expect.poll(() => saved.strokes().length).toBe(1)
  const target = await pageAt(page, path[0])
  expect(Math.abs(saved.strokes()[0].points[0] - target.x)).toBeLessThan(8)
  expect(Math.abs(saved.strokes()[0].points[1] - target.y)).toBeLessThan(8)

  // 선택해서 화면 오른쪽으로 60px 끌면 장에서는 역변환한 만큼 옮겨진다
  await page.keyboard.press('v')
  const grab = path[4]
  await hands.mouseStroke([grab, { x: grab.x + 30, y: grab.y }, { x: grab.x + 60, y: grab.y }]) // 선택 도구에서는 끌기
  const p0 = await pageAt(page, { x: 0, y: 0 })
  const p1 = await pageAt(page, { x: 60, y: 0 })
  const move = { x: p1.x - p0.x, y: p1.y - p0.y }
  await expect.poll(() => Math.abs(saved.strokes()[0].points[0] - target.x - move.x), { timeout: 2_000 }).toBeLessThan(6)
  expect(Math.abs(saved.strokes()[0].points[1] - target.y - move.y)).toBeLessThan(6)

  // 지우개: 옮겨진 획의 화면 자리를 지나면 지워진다
  const moved = { x: grab.x + 60, y: grab.y }
  await page.keyboard.press('e')
  await hands.mouseStroke([{ x: moved.x - 20, y: moved.y }, moved, { x: moved.x + 20, y: moved.y }])
  await expect.poll(() => saved.strokes().length).toBe(0)

  // 글 상자 놓기: 누른 자리의 장 좌표에 놓인다
  await page.keyboard.press('t')
  const spot = await onScreen(page, 0.5, 0.5)
  await page.mouse.click(spot.x, spot.y)
  await page.keyboard.insertText('hi')
  await expect.poll(() => saved.boxes().length).toBe(1)
  const at = await pageAt(page, spot)
  const box = saved.boxes()[0]
  expect(Math.abs(box.x - at.x)).toBeLessThan(60)
  expect(Math.abs(box.y - at.y)).toBeLessThan(60)
})

test('#89 90도 + 거울에서 핀치 확대: 손가락 가운데 아래의 장 자리가 그대로이고 스크롤이 맞는다', async ({ page }) => {
  await openNote(page)
  const hands = await Hands.on(page)
  await page.keyboard.press('r')
  await page.keyboard.press('m')
  await zoomIn(page, 2)
  await nextFrames(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  const center = { x: vp.x + vp.width * 0.4, y: vp.y + vp.height * 0.4 }
  const before = await zoomPercent(page)
  const at = await pageAt(page, center)
  await hands.pinch(center, 100, 220, 8)
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before)
  await nextFrames(page)
  const after = await pageAt(page, center)
  expect(Math.abs(after.x - at.x)).toBeLessThan(40)
  expect(Math.abs(after.y - at.y)).toBeLessThan(40)
})
