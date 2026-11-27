import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsButton } from './ShortcutsButton'

test('#189 새 키를 받는 중에도 단추 위의 Enter는 그 단추의 동작을 한다', async () => {
  render(<ShortcutsButton open onOpen={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /^펜 단축키 바꾸기/ }))
  screen.getByRole('button', { name: '끄기' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: '펜 단축키 바꾸기: 없음' })).toBeInTheDocument()
})

test('새 키를 받는 중 단추 밖의 Enter는 받을 수 없는 키라고 알린다', async () => {
  render(<ShortcutsButton open onOpen={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /^펜 단축키 바꾸기/ }))
  expect(fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', code: 'Enter' })).toBe(false)
  expect(screen.getByText(/정해 둔 쓰임/)).toBeInTheDocument()
})
