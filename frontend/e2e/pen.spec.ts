import { expect, test } from '@playwright/test'
import { Hands, frameScale, nextFrames, openNote, savedStrokes, scrollTopOf, zoomIn } from './helpers'

// #34 펜 전용 모드·팜 리젝션, 펜 압력, #67 잘린 좌표 펴기

test('#34 펜 전용(auto): 펜 획 뒤 손가락(손바닥)은 획 없이 종이를 옮기고, 손 버튼으로 끄면 다시 그린다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  await zoomIn(page)

  // 펜을 보기 전에는 손가락도 그린다
  await hands.fingerDrag({ x: vp.x + 200, y: vp.y + 200 }, { x: vp.x + 260, y: vp.y + 230 }, 4)
  await savedStrokes(page, saved, 1)

  // 펜 한 번 → 토스트, 자동 모드가 켜진다
  await hands.penStroke([0, 1, 2, 3, 4].map((i) => ({ x: vp.x + 300 + i * 12, y: vp.y + 300 })))
  await expect(page.getByText('펜이 감지돼 손가락은 화면만 옮겨요')).toBeVisible()
  await savedStrokes(page, saved, 2)
  const hand = page.getByRole('button', { name: '손가락으로 화면 옮기기' })
  await expect(hand).toHaveAttribute('aria-pressed', 'true')

  // 손바닥 한 손가락 끌기: 획은 그대로, 종이가 스크롤된다
  const top = await scrollTopOf(page)
  await hands.fingerDrag({ x: vp.x + 400, y: vp.y + 600 }, { x: vp.x + 400, y: vp.y + 400 }, 8)
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(top + 50)
  await nextFrames(page)
  expect(saved.strokes()).toHaveLength(2)

  // 끔: 손가락이 다시 그린다
  await hand.click()
  await expect(hand).toHaveAttribute('aria-pressed', 'false')
  await hands.fingerDrag({ x: vp.x + 200, y: vp.y + 500 }, { x: vp.x + 260, y: vp.y + 530 }, 4)
  await savedStrokes(page, saved, 3)
})

test('#34 펜 압력: 압력이 다른 펜 이벤트가 획의 필압으로 남는다', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  const forces = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
  await hands.penStroke(forces.map((force, i) => ({ x: vp.x + 150 + i * 12, y: vp.y + 200 + i * 5, force })))
  const [stroke] = await savedStrokes(page, saved, 1)
  const pressures = stroke.points.filter((_, i) => i % 3 === 2)
  expect(pressures.length).toBeGreaterThanOrEqual(forces.length)
  expect(Math.max(...pressures) - Math.min(...pressures)).toBeGreaterThan(0.5)
  // 가벼운 데서 시작해 점점 세게: 필압이 줄지 않는다
  expect(pressures[0]).toBeLessThan(0.3)
  expect(pressures[pressures.length - 1]).toBeGreaterThan(0.7)
})

test('#67 정수 픽셀로 잘린 펜 좌표의 계단을 편다(저장된 점이 참 선에 더 가깝다)', async ({ page }) => {
  const saved = await openNote(page)
  const hands = await Hands.on(page)
  const vp = (await page.locator('.page-viewport').boundingBox())!
  const scale = await frameScale(page)
  // 비스듬한 곧은 선, 화면 정수 픽셀로 자른 좌표(아이패드 Safari가 주는 모양)
  const n = 200
  const raw = Array.from({ length: n + 1 }, (_, i) => ({
    x: Math.round(vp.x + 150 + 0.13 * i * 2.5),
    y: Math.round(vp.y + 100 + i * 2.5),
    force: 0.5,
  }))
  await hands.penStroke(raw)
  const [stroke] = await savedStrokes(page, saved, 1)

  // 화면 좌표 → 장 좌표(프레임 왼쪽 위 기준). 참 선은 입력 점의 최소제곱 직선이다.
  const frame = (await page.locator('.page-frame').boundingBox())!
  const toPage = (x: number, y: number) => ({ x: (x - frame.x) / scale, y: (y - frame.y) / scale })
  const wobble = (pts: { x: number; y: number }[]) => {
    const inner = pts.slice(15, pts.length - 15)
    const mx = inner.reduce((a, p) => a + p.x, 0) / inner.length
    const my = inner.reduce((a, p) => a + p.y, 0) / inner.length
    // x = a·y + b 를 최소제곱으로
    let sxy = 0
    let syy = 0
    for (const p of inner) {
      sxy += (p.y - my) * (p.x - mx)
      syy += (p.y - my) ** 2
    }
    const a = sxy / syy
    const sum = inner.reduce((s, p) => s + ((p.x - mx - a * (p.y - my)) / Math.hypot(1, a)) ** 2, 0)
    return Math.sqrt(sum / inner.length)
  }
  const before = wobble(raw.map((p) => toPage(p.x, p.y)))
  const saveds = Array.from({ length: stroke.points.length / 3 }, (_, i) => ({ x: stroke.points[i * 3], y: stroke.points[i * 3 + 1] }))
  const after = wobble(saveds)
  expect(before).toBeGreaterThan(0.2 / scale)
  expect(after).toBeLessThan(before / 2)
})
