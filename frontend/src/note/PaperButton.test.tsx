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
  expect(screen.queryByRole('radio', { name: '칠판' })).not.toBeInTheDocument()
})

test('지금 종이가 골라져 보인다(직접 고른 색 포함)', async () => {
  render(<PaperButton paper={{ pattern: 'grid', margin: false, color: '#fde8ef' }} onChange={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: '종이' }))
  expect(screen.getByRole('radio', { name: '모눈' })).toBeChecked()
  expect(screen.getByRole('radio', { name: '직접 고른 색' })).toBeChecked()
  expect(screen.getByRole('radio', { name: '흰 종이' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: /왼쪽 여백 선/ })).not.toBeChecked()
})

test('직접 고른 색: 색 코드를 넣고 이 색으로를 누르면 그 색으로 바꾸고 종이 창으로 돌아온다', async () => {
  const onChange = vi.fn()
  render(<PaperButton paper={DEFAULT_PAPER} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: '종이' }))
  await userEvent.click(screen.getByRole('radio', { name: '직접 고른 색' }))
  expect(onChange).not.toHaveBeenCalled()
  screen.getByRole('dialog', { name: '종이 색 만들기' })

  const code = screen.getByRole('textbox', { name: '색 코드' })
  await userEvent.clear(code)
  await userEvent.type(code, '#E8F4EA')
  await userEvent.click(screen.getByRole('button', { name: '이 색으로' }))
  expect(onChange).toHaveBeenLastCalledWith({ color: '#e8f4ea' })
  screen.getByRole('dialog', { name: '종이' })
})

test('직접 고른 색 창에서 취소하면 아무것도 바꾸지 않는다', async () => {
  const onChange = vi.fn()
  render(<PaperButton paper={DEFAULT_PAPER} onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: '종이' }))
  await userEvent.click(screen.getByRole('radio', { name: '직접 고른 색' }))
  await userEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(onChange).not.toHaveBeenCalled()
  screen.getByRole('dialog', { name: '종이' })
})
