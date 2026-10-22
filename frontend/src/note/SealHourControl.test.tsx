import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SealHourControl, sealHourLabel } from './SealHourControl'

test('봉인 시각 표시 문구', () => {
  expect(sealHourLabel(0)).toBe('새 페이지 00:00')
  expect(sealHourLabel(4)).toBe('새 페이지 04:00')
  expect(sealHourLabel(23)).toBe('새 페이지 23:00')
})

test('만든 사람은 새 페이지가 열리는 시각을 0~23시 중에 고른다', async () => {
  const onChange = vi.fn(async () => {})
  render(<SealHourControl sealHour={0} editable onChange={onChange} />)
  await userEvent.click(screen.getByRole('button', { name: '새 페이지 00:00' }))
  const select = screen.getByRole('combobox', { name: '새 페이지 시각' })
  const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value)
  expect(values).toHaveLength(24)
  expect(values[0]).toBe('0')
  expect(values[23]).toBe('23')
  await userEvent.selectOptions(select, '4')
  expect(onChange).toHaveBeenCalledWith(4)
  // 고르면 창이 닫힌다
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('참여자에게는 아무것도 보이지 않는다(카운트다운으로 안다)', () => {
  const { container } = render(<SealHourControl sealHour={4} editable={false} onChange={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
