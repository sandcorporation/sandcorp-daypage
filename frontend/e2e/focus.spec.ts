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
