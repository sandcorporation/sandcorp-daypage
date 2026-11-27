import { expect, request, test } from '@playwright/test'
import { openNote } from './helpers'

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
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(badge).toBeFocused()

  // #190 지우고 홈으로 오면 알린다
  await badge.press('Enter')
  await dialog.getByRole('button', { name: '이 노트 삭제' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click()
  await expect(page.getByRole('status').filter({ hasText: /노트를 지웠어요$/ })).toBeVisible()
})
