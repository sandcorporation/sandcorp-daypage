import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PaperButton } from './PaperButton'
import { DEFAULT_PAPER } from '../page/paper'

test('종이 버튼을 누르면 모양·여백 선·색을 고르고, 고른 것만 바꿔 알린다', async () => {
  const onChange = vi.fn()
  render(<PaperButton paper={DEFAULT_PAPER} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: '종이' }))
  const dialog = screen.getByRole('dialog', { name: '종이' })
  expect(dialog).toHaveTextContent('참여한 모든 사람의 화면이 같이 바뀌어요')

  expect(screen.getByRole('radio', { name: '줄 노트' })).toBeChecked()
  await userEvent.click(screen.getByRole('radio', { name: '점' }))
  expect(onChange).toHaveBeenLastCalledWith({ pattern: 'dot' })

  await userEvent.click(screen.getByRole('checkbox', { name: /왼쪽 여백 선/ }))
  expect(onChange).toHaveBeenLastCalledWith({ margin: false })

  await userEvent.click(screen.getByRole('radio', { name: '미색 종이' }))
  expect(onChange).toHaveBeenLastCalledWith({ color: 'cream' })
})

test('지금 종이가 골라져 보인다', async () => {
  render(<PaperButton paper={{ pattern: 'grid', margin: false, color: 'chalk' }} onChange={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: '종이' }))
  expect(screen.getByRole('radio', { name: '모눈' })).toBeChecked()
  expect(screen.getByRole('radio', { name: '칠판' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /왼쪽 여백 선/ })).not.toBeChecked()
})
