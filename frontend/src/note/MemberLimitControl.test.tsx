import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberLimitControl, memberLabel } from './MemberLimitControl'

test('정원 표시 문구', () => {
  expect(memberLabel(3, null)).toBe('참여 3명')
  expect(memberLabel(2, 4)).toBe('참여 2 / 4명')
})

test('만든 사람은 정원을 바꿀 수 있고, 지금 인원보다 작은 값은 고를 수 없다', async () => {
  const onChange = vi.fn(async () => {})
  render(<MemberLimitControl memberCount={3} memberLimit={null} editable onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: '참여 3명' }))
  const select = screen.getByRole('combobox', { name: /정원/ })
  const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value)
  expect(values).not.toContain('2')
  expect(values).toContain('3')
  await userEvent.selectOptions(select, '5')
  expect(onChange).toHaveBeenCalledWith(5)
})

test('참여자에게는 정원이 글자로만 보인다', () => {
  render(<MemberLimitControl memberCount={2} memberLimit={4} editable={false} onChange={vi.fn()} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByText('참여 2 / 4명')).toBeInTheDocument()
})
