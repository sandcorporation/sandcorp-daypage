import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { ToolPopover } from './ToolPopover'

function Harness() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button ref={button} type="button" onClick={() => setOpen((v) => !v)}>
        열기
      </button>
      <p>바깥</p>
      {open && (
        <ToolPopover title="펜 종류" anchor={button} onClose={() => setOpen(false)}>
          <button type="button">안의 버튼</button>
        </ToolPopover>
      )}
    </div>
  )
}

function phoneWidth(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

afterEach(() => vi.unstubAllGlobals())

test('버튼으로 열고, 이름 있는 대화 상자로 보인다', async () => {
  renderOpen()
  expect(screen.getByRole('dialog', { name: '펜 종류' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '안의 버튼' })).toBeInTheDocument()
})

test('Esc로 닫히고 포커스가 연 버튼으로 돌아간다', async () => {
  renderOpen()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '열기' })).toHaveFocus()
})

test('바깥을 누르면 닫히고, 안을 누르면 그대로다', async () => {
  renderOpen()
  await userEvent.click(screen.getByRole('button', { name: '안의 버튼' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await userEvent.click(screen.getByText('바깥'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('닫기 버튼으로 닫힌다', async () => {
  renderOpen()
  await userEvent.click(screen.getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('연 버튼을 다시 누르면 닫힌다(바깥 누르기로 닫혔다 다시 열리지 않는다)', async () => {
  renderOpen()
  await userEvent.click(screen.getByRole('button', { name: '열기' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('데스크톱 폭에서는 팝오버, 폰 폭에서는 아래에서 올라오는 시트', async () => {
  phoneWidth(false)
  const { unmount } = renderOpen()
  expect(screen.getByRole('dialog')).toHaveAttribute('data-variant', 'popover')
  unmount()
  phoneWidth(true)
  renderOpen()
  expect(screen.getByRole('dialog')).toHaveAttribute('data-variant', 'sheet')
})

function renderOpen() {
  const result = render(<Harness />)
  act(() => screen.getByRole('button', { name: '열기' }).click())
  return result
}
