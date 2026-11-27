import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SealHourControl, sealHourLabel } from './SealHourControl'

// 서버 시각 15:00(KST), 지금 장은 00:00에 열렸다
const OPENED_AT = '2026-10-15T00:00:00+09:00'
const NOW = new Date('2026-10-15T15:00:00+09:00')
const WARNING = /저장하면 지금 페이지가 바로 기록에 보관돼요/

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

function renderControl(sealHour = 0, clockOffset = 0) {
  const onChange = vi.fn(async () => {})
  render(
    <SealHourControl sealHour={sealHour} openedAt={OPENED_AT} clockOffset={clockOffset} editable onChange={onChange} />,
  )
  return onChange
}

const trigger = () => screen.getByRole('button', { name: /^새 페이지 \d/ })
const select = () => screen.getByRole('combobox', { name: '새 페이지 시각' }) as HTMLSelectElement
const pick = (hour: number) => fireEvent.change(select(), { target: { value: String(hour) } })

test('봉인 시각 표시 문구', () => {
  expect(sealHourLabel(0)).toBe('새 페이지 00:00')
  expect(sealHourLabel(4)).toBe('새 페이지 04:00')
  expect(sealHourLabel(23)).toBe('새 페이지 23:00')
})

test('만든 사람은 새 페이지가 열리는 시각을 0~23시 중에 고른다', async () => {
  renderControl()
  await userEvent.click(trigger())
  const values = Array.from(select().options).map((o) => o.value)
  expect(values).toHaveLength(24)
  expect(values[0]).toBe('0')
  expect(values[23]).toBe('23')
})

test('선택을 옮기는 동안에는 저장하지 않고, 저장을 눌러야 바꾸고 닫으며 초점이 단추로 돌아온다', async () => {
  const onChange = renderControl()
  await userEvent.click(trigger())
  // 키보드 화살표는 닫힌 select의 값을 하나씩 바꾼다(jsdom은 화살표를 흉내 내지 않아 change로 옮긴다)
  for (const h of [1, 2, 12, 18]) pick(h)
  expect(onChange).not.toHaveBeenCalled()
  expect(select()).toHaveValue('18')
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith(18)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger()).toHaveFocus()
})

test('선택 칸에서 Enter로도 저장한다', async () => {
  const onChange = renderControl()
  await userEvent.click(trigger())
  pick(18)
  select().focus()
  await userEvent.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenCalledWith(18)
  expect(trigger()).toHaveFocus()
})

test('Escape는 저장하지 않고 닫으며 초점이 단추로 돌아오고, 다시 열면 지금 시각부터다', async () => {
  const onChange = renderControl()
  await userEvent.click(trigger())
  pick(12)
  select().focus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger()).toHaveFocus()
  await userEvent.click(trigger())
  expect(select()).toHaveValue('0')
  expect(onChange).not.toHaveBeenCalled()
})

test('그대로 저장하면 요청 없이 닫는다', async () => {
  const onChange = renderControl()
  await userEvent.click(trigger())
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('저장하면 지금 장이 바로 보관되는 시각을 고르면 저장 전에 경고한다', async () => {
  renderControl()
  await userEvent.click(trigger())
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  pick(12) // 00:00에 연 장의 다음 12:00은 이미 지났다
  expect(screen.getByText(WARNING)).toHaveTextContent('되돌릴 수 없어요')
  pick(15) // 같은 순간도 보관된다(서버: due_at <= now)
  expect(screen.getByText(WARNING)).toBeInTheDocument()
  pick(16)
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  pick(0) // 바꾸지 않으면 저장할 것이 없다
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
})

test('경고는 서버 시계로 판단한다', async () => {
  renderControl(0, 2 * 3600 * 1000) // 서버는 17:00
  await userEvent.click(trigger())
  pick(16)
  expect(screen.getByText(WARNING)).toBeInTheDocument()
})

test('창을 열어 둔 사이에 고른 시각이 지나면 경고가 나타난다', async () => {
  renderControl()
  await userEvent.click(trigger())
  pick(16)
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  act(() => {
    vi.advanceTimersByTime(3600 * 1000)
  })
  expect(screen.getByText(WARNING)).toBeInTheDocument()
})

test('경고가 뜨기 전에 시각이 지나 버렸으면 첫 저장은 보내지 않고 경고를 보인다', async () => {
  const onChange = renderControl()
  await userEvent.click(trigger())
  pick(16)
  vi.setSystemTime(new Date('2026-10-15T16:00:00+09:00')) // 다음 틱 전
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByText(WARNING)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(onChange).toHaveBeenCalledWith(16)
})

test('참여자에게는 아무것도 보이지 않는다(카운트다운으로 안다)', () => {
  const { container } = render(
    <SealHourControl sealHour={4} openedAt={OPENED_AT} clockOffset={0} editable={false} onChange={vi.fn()} />,
  )
  expect(container).toBeEmptyDOMElement()
})
