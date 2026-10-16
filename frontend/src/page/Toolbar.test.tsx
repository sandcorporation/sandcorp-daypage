import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import { Toolbar } from './Toolbar'

type Props = ComponentProps<typeof Toolbar>

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    tool: 'pen',
    ink: '#2A47B0',
    widthLevel: 1,
    canUndo: false,
    canRedo: false,
    onTool: vi.fn(),
    onInk: vi.fn(),
    onWidth: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    font: 'pen',
    onFont: vi.fn(),
    showFont: false,
    brush: 'ballpoint',
    onBrush: vi.fn(),
    pressure: true,
    onPressure: vi.fn(),
    ...over,
  }
  render(<Toolbar {...props} />)
  return props
}

describe('펜 종류', () => {
  test('펜이 골라진 채로 펜을 다시 누르면 펜 종류 창이 열린다', async () => {
    const props = setup({ tool: 'pen' })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    expect(screen.getByRole('dialog', { name: '펜 종류' })).toBeInTheDocument()
    expect(props.onTool).not.toHaveBeenCalled()
  })

  test('다른 도구일 때 펜을 누르면 펜으로 바뀌기만 한다', async () => {
    const props = setup({ tool: 'highlighter' })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    expect(props.onTool).toHaveBeenCalledWith('pen')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('붓펜을 고르면 알리고 창을 닫는다. 지금 펜 종류가 표시된다', async () => {
    const props = setup({ tool: 'pen', brush: 'ballpoint' })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    expect(screen.getByRole('button', { name: /^볼펜/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^붓펜/ }))
    expect(props.onBrush).toHaveBeenCalledWith('brushpen')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('펜 종류 창에서 필압 따라 굵기 바꾸기를 끌 수 있다', async () => {
    const props = setup({ tool: 'pen', pressure: true })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    const box = screen.getByRole('checkbox', { name: '필압 따라 굵기 바꾸기' })
    expect(box).toBeChecked()
    await userEvent.click(box)
    expect(props.onPressure).toHaveBeenCalledWith(false)
  })

  test('펜 버튼 이름에 지금 펜 종류가 들어 있다', () => {
    setup({ brush: 'brushpen' })
    expect(screen.getByRole('button', { name: '펜 (붓펜)' })).toBeInTheDocument()
  })
})
