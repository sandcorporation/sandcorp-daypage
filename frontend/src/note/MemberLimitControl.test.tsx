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
})

async function openPicker(onChange = vi.fn(async () => {}), memberLimit: number | null = 4) {
  render(<MemberLimitControl memberCount={3} memberLimit={memberLimit} editable onChange={onChange} />)
  const badge = screen.getByRole('button', { name: /^참여 / })
  await userEvent.click(badge)
  const select = screen.getByRole('combobox', { name: /정원/ })
  select.focus()
  return { onChange, badge, select }
}

test('값을 고르는 동안에는 저장하지 않고 창이 열린 채 남는다', async () => {
  const { onChange, select } = await openPicker()
  // jsdom은 select의 화살표 입력을 흉내 내지 않아, 화살표마다 나는 change를 차례로 낸다
  for (const v of ['5', '6', '8']) await userEvent.selectOptions(select, v)
  expect(onChange).not.toHaveBeenCalled()
  expect(select).toHaveValue('8')
  expect(select).toHaveFocus()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test.each(['저장 단추', 'Enter'])('%s로 저장하면 창이 닫히고 초점이 정원 단추로 돌아온다', async (how) => {
  const { onChange, badge, select } = await openPicker()
  await userEvent.selectOptions(select, '8')
  if (how === 'Enter') await userEvent.keyboard('{Enter}')
  else await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith(8)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(badge).toHaveFocus()
})

test('무제한으로도 저장하고, 값을 바꾸지 않고 저장하면 아무것도 보내지 않는다', async () => {
  const { onChange, badge, select } = await openPicker()
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(onChange).not.toHaveBeenCalled()
  await userEvent.click(badge)
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /정원/ }), 'unlimited')
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  expect(select).not.toBeInTheDocument()
})

test.each(['선택 칸', 'body'])('초점이 %s에 있을 때 Esc는 저장 없이 닫고 정원 단추로 돌아온다', async (where) => {
  const { onChange, badge, select } = await openPicker()
  await userEvent.selectOptions(select, '8')
  if (where === 'body') select.blur()
  await userEvent.keyboard('{Escape}')
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(badge).toHaveFocus()
  // 다시 열면 고르다 만 값은 남지 않는다
  await userEvent.click(badge)
  expect(screen.getByRole('combobox', { name: /정원/ })).toHaveValue('4')
})

test('「이 노트 삭제」를 누르면 확인 창이 돌려줄 자리(정원 단추)에 초점을 둔다', async () => {
  const onDelete = vi.fn()
  render(<MemberLimitControl memberCount={1} memberLimit={null} editable onChange={vi.fn()} onDelete={onDelete} />)
  await userEvent.click(screen.getByRole('button', { name: '참여 1명' }))
  await userEvent.click(screen.getByRole('button', { name: '이 노트 삭제' }))
  expect(screen.getByRole('button', { name: '참여 1명' })).toHaveFocus()
})

test('참여자에게는 정원이 글자로만 보인다', () => {
  render(<MemberLimitControl memberCount={2} memberLimit={4} editable={false} onChange={vi.fn()} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByText('참여 2 / 4명')).toBeInTheDocument()
})
