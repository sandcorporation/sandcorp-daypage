import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteName } from './NoteName'

test('만든 사람은 이름을 눌러 바꾸고 Enter로 저장한다', async () => {
  const onRename = vi.fn(async () => {})
  render(<NoteName name="이름 없는 노트" editable onRename={onRename} />)
  await userEvent.click(screen.getByRole('button', { name: /노트 이름 바꾸기/ }))
  const input = screen.getByLabelText('노트 이름')
  await userEvent.clear(input)
  await userEvent.type(input, '우리집 공용 노트{Enter}')
  expect(onRename).toHaveBeenCalledWith('우리집 공용 노트')
})

test('Escape는 바꾸지 않고 닫는다', async () => {
  const onRename = vi.fn(async () => {})
  render(<NoteName name="원래" editable onRename={onRename} />)
  await userEvent.click(screen.getByRole('button', { name: /노트 이름 바꾸기/ }))
  await userEvent.type(screen.getByLabelText('노트 이름'), '바꿈{Escape}')
  expect(onRename).not.toHaveBeenCalled()
})

test('참여자에게는 이름이 글자로만 보인다', () => {
  render(<NoteName name="공용" editable={false} onRename={vi.fn()} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByText('공용')).toBeInTheDocument()
})
