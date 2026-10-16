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
    noteColors: [],
    onAddColor: vi.fn(async () => {}),
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

describe('노트 색', () => {
  test('노트 색이 기본 잉크 아래에 보이고 고를 수 있다', async () => {
    const props = setup({ noteColors: ['#16794f', '#8b5cf6'], ink: '#8b5cf6' })
    const green = screen.getByRole('button', { name: '노트 색 #16794f' })
    expect(screen.getByRole('button', { name: '노트 색 #8b5cf6' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(green)
    expect(props.onInk).toHaveBeenCalledWith('#16794f')
  })

  test('"+"로 색 만들기 창을 열고, 색 코드를 넣어 노트 색으로 더한다', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: '색 추가' }))
    expect(screen.getByRole('dialog', { name: '새 색 만들기' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: '색 코드' })
    await userEvent.clear(input)
    await userEvent.type(input, '#12AB34')
    await userEvent.click(screen.getByRole('button', { name: '이 색 더하기' }))
    expect(props.onAddColor).toHaveBeenCalledWith('#12ab34')
  })

  test('추천 색을 누르면 그 색이 골라진다', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: '색 추가' }))
    await userEvent.click(screen.getByRole('button', { name: '추천 색 #0e7490' }))
    expect(screen.getByRole('textbox', { name: '색 코드' })).toHaveValue('#0e7490')
    await userEvent.click(screen.getByRole('button', { name: '이 색 더하기' }))
    expect(props.onAddColor).toHaveBeenCalledWith('#0e7490')
  })

  test('형식이 틀린 색 코드는 더할 수 없다', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: '색 추가' }))
    const input = screen.getByRole('textbox', { name: '색 코드' })
    await userEvent.clear(input)
    await userEvent.type(input, '#12')
    expect(screen.getByRole('button', { name: '이 색 더하기' })).toBeDisabled()
  })

  test('노트 색이 가득 차면 더하기 대신 안내를 본다', async () => {
    setup({ noteColors: ['#000001', '#000002', '#000003', '#000004', '#000005', '#000006', '#000007', '#000008'] })
    await userEvent.click(screen.getByRole('button', { name: '색 추가' }))
    expect(screen.getByRole('button', { name: '이 색 더하기' })).toBeDisabled()
    expect(screen.getByText(/8개까지/)).toBeInTheDocument()
  })
})
