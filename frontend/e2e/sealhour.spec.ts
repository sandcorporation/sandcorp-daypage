import { expect, test } from '@playwright/test'
import { openNote } from './helpers'

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
