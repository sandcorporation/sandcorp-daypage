import { expect, test } from '@playwright/test'
import { Hands, openNote, savedStrokes } from './helpers'

// #173 확인 창의 초점 가둠·돌려주기. 지워지거나 disabled가 된 요소의 초점은 실제 브라우저에서만 드러난다.

test('#173 레이어 지우기 확인 창은 초점을 가두고, Esc는 창만 닫고, 닫으면 뜻 있는 자리로 간다', async ({ page }) => {
  await openNote(page)
  await page.getByRole('button', { name: '레이어', exact: true }).click()
  await page.getByRole('button', { name: '+ 새 레이어' }).click()
  const remove = page.getByRole('button', { name: '레이어 2 지우기' })
  await remove.click()
  const dialog = page.getByRole('alertdialog')
  const cancel = dialog.getByRole('button', { name: '취소' })
  const ok = dialog.getByRole('button', { name: '지우기' })
  for (const [key, target] of [['Tab', ok], ['Tab', cancel], ['Shift+Tab', ok]] as const) {
    await page.keyboard.press(key)
    await expect(target).toBeFocused()
  }
  await page.keyboard.press('Escape')
  await expect(remove).toBeFocused()
})

test('#173 레이어 지우기 확인 창은 바깥을 눌러 닫거나 지운 뒤에도 초점을 남긴다', async ({ page }) => {
  await openNote(page)
  await page.getByRole('button', { name: '레이어', exact: true }).click()
  await page.getByRole('button', { name: '+ 새 레이어' }).click()
  const remove = page.getByRole('button', { name: '레이어 2 지우기' })
  const dialog = page.getByRole('alertdialog')

  // 바깥(백드롭) 누르기로 닫아도 연 버튼으로
  await remove.click()
  await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(remove).toBeFocused()

  await remove.click()
  await dialog.getByRole('button', { name: '지우기' }).click()
  await expect(page.getByRole('button', { name: '+ 새 레이어' })).toBeFocused()
})

test('#173 이름 바꾸기·노트 지우기·만들기 뒤에도 초점이 body로 빠지지 않는다', async ({ page }) => {
  await openNote(page)
  await page.getByRole('button', { name: /노트 이름 바꾸기/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /노트 이름 바꾸기/ })).toBeFocused()

  const member = page.getByRole('button', { name: /^참여 / })
  await member.click()
  await page.getByRole('button', { name: '이 노트 삭제' }).click()
  await page.keyboard.press('Escape')
  await expect(member).toBeFocused()

  await member.click()
  await page.getByRole('button', { name: '이 노트 삭제' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '새 노트 만들기' })).toBeFocused()

  await page.getByRole('button', { name: '노트 만들기' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '이름 없는 노트' })).toBeFocused()
})

test('#173 「이 장 모두 지우기」 확인 창이 닫히면 지우개 창을 연 버튼으로 간다', async ({ page }) => {
  const saved = await openNote(page)
  const box = (await page.locator('.page-frame').boundingBox())!
  const hands = await Hands.on(page)
  await hands.mouseStroke([{ x: box.x + 100, y: box.y + 200 }, { x: box.x + 200, y: box.y + 240 }])
  await savedStrokes(page, saved, 1)
  await page.getByRole('button', { name: /^지우개/ }).first().click()
  const opener = page.locator('button[aria-haspopup="dialog"]').filter({ has: page.locator('.width-name') })
  await opener.click()
  await page.getByRole('button', { name: '이 장 모두 지우기' }).click()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
})

test('#183 건의를 보내고 닫는 동안 초점이 body로 빠지지 않는다', async ({ page }) => {
  await openNote(page)
  await page.route('**/api/suggestions', (route) => route.fulfill({ status: 201, json: { id: 1 } }))
  const opener = page.getByRole('button', { name: '기능 건의' })
  await opener.click()
  await page.getByRole('textbox', { name: '건의 내용' }).fill('하나')
  await page.getByRole('button', { name: '보내기' }).press('Enter')
  await expect(page.getByText('보내 주셔서 고마워요!')).toBeFocused()
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).last().press('Enter')
  await expect(opener).toBeFocused()
})

test('#183 도구 창에서 고르거나 내용이 바뀌어도, 한계에 닿아도 초점이 남는다', async ({ page }) => {
  await openNote(page)
  const ink = page.getByRole('button', { name: /^잉크:/ })
  await ink.press('Enter')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '+ 새 색 만들기' }).press('Enter')
  await expect(dialog).toBeFocused()
  await dialog.getByRole('button', { name: '잉크 목록으로' }).press('Enter')
  await expect(dialog).toBeFocused()
  await dialog.locator('.ink-option').nth(1).press('Enter')
  await expect(page.getByRole('button', { name: /^잉크:/ })).toBeFocused()

  const zoomOut = page.getByRole('button', { name: '축소' })
  for (let i = 0; i < 6; i++) await zoomOut.press('Enter')
  await expect(zoomOut).toHaveAttribute('aria-disabled', 'true')
  await expect(zoomOut).toBeFocused()
})

test('#189 곡선 중 취소·완료에 Enter를 누르면 그 단추의 일을 하고, 지면에 찍은 뒤의 Enter는 곡선을 끝낸다', async ({ page }) => {
  const saved = await openNote(page)
  const box = (await page.locator('.page-frame').boundingBox())!
  const hands = await Hands.on(page)
  const tool = page.getByRole('button', { name: /^도형/ })
  await tool.click()
  await tool.click()
  await page.getByRole('button', { name: /^곡선:/ }).click()
  await page.keyboard.press('Escape')
  await expect(tool).toBeFocused()
  const bar = page.getByRole('toolbar', { name: '곡선' })
  let row = 0
  const twoPoints = async () => {
    const y = box.y + 150 + 60 * row++
    for (const x of [box.x + 100, box.x + 220]) await hands.mouseStroke([{ x, y }])
    await expect(bar).toBeVisible()
  }

  await twoPoints()
  await expect(tool).not.toBeFocused()
  await bar.getByRole('button', { name: '취소' }).press('Enter')
  await expect(bar).toBeHidden()
  await expect(tool).toBeFocused()

  await twoPoints()
  await bar.getByRole('button', { name: '완료' }).press('Enter')
  await expect(tool).toBeFocused()
  await savedStrokes(page, saved, 1)

  // 도구 단추에 있던 초점이 지면으로 가므로 Enter는 곡선을 끝낸다. 취소한 곡선은 저장되지 않아 모두 두 획이다
  await twoPoints()
  await page.keyboard.press('Enter')
  await expect(bar).toBeHidden()
  await savedStrokes(page, saved, 2)
})

test('#196 마우스로 누른 도구 단추에 초점이 남아도 Space+끌기는 화면을 옮기고, Tab으로 온 단추의 Space는 그 단추를 누른다', async ({ page }) => {
  await openNote(page)
  const view = page.locator('.page-viewport')
  const zoomIn = page.getByRole('button', { name: '확대' })
  for (let i = 0; i < 4; i++) await zoomIn.click()
  const pen = page.getByRole('button', { name: /^펜/ }).first()
  const eraser = page.getByRole('button', { name: /^지우개/ }).first()
  await eraser.click()
  // 누른 채로 도구를 바꿔 두면, Space가 이 단추를 누를 때 지우개로 되돌아가 드러난다
  await page.evaluate(() => {
    const w = window as unknown as { eraserClicks: number }
    w.eraserClicks = 0
    document.activeElement!.addEventListener('click', () => w.eraserClicks++)
  })
  await expect(eraser).toBeFocused()

  const box = (await view.boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const before = await view.evaluate((el) => el.scrollTop)
  await page.mouse.move(at.x, at.y)
  await page.keyboard.down('Space')
  await page.keyboard.down('Space') // 누르고 있으면 오는 반복
  await page.mouse.down()
  await page.mouse.move(at.x, at.y - 120, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(before)
  expect(await page.evaluate(() => (window as unknown as { eraserClicks: number }).eraserClicks)).toBe(0)

  // 끌지 않고 반복까지 온 Space도 단추를 누르지 않는다
  await zoomIn.click()
  await expect(zoomIn).toBeFocused()
  const zoomed = await page.locator('.page-frame').boundingBox()
  await page.keyboard.down('Space')
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect((await page.locator('.page-frame').boundingBox())!.width).toBe(zoomed!.width)

  await pen.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(pen).toBeFocused()
  await expect(pen).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Space')
  await expect(pen).toHaveAttribute('aria-pressed', 'true')
})

test('#196 곡선 막대 「취소」에 초점을 두고 Esc를 누르면 곡선이 취소된다', async ({ page }) => {
  await openNote(page)
  const box = (await page.locator('.page-frame').boundingBox())!
  const hands = await Hands.on(page)
  const tool = page.getByRole('button', { name: /^도형/ })
  await tool.click()
  await tool.click()
  await page.getByRole('button', { name: /^곡선:/ }).click()
  await page.keyboard.press('Escape')
  for (const x of [box.x + 100, box.x + 220]) await hands.mouseStroke([{ x, y: box.y + 150 }])
  const bar = page.getByRole('toolbar', { name: '곡선' })
  await bar.getByRole('button', { name: '취소' }).focus()
  await page.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  await expect(tool).toBeFocused()
})

test('#200 마우스로 연 도구 창을 Esc로 닫아도 Space+끌기는 화면을 옮기고 획을 긋거나 창을 다시 열지 않는다', async ({ page }) => {
  const saved = await openNote(page)
  const view = page.locator('.page-viewport')
  const zoomIn = page.getByRole('button', { name: '확대' })
  for (let i = 0; i < 4; i++) await zoomIn.click()
  const opener = page.locator('button[aria-haspopup="dialog"]').filter({ has: page.locator('.width-name') })
  await opener.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(opener).toBeFocused()

  const box = (await view.boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const before = await view.evaluate((el) => el.scrollTop)
  await page.mouse.move(at.x, at.y)
  await page.keyboard.down('Space')
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(at.x, at.y - 120, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(before)
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(saved.strokes()).toHaveLength(0)
})
