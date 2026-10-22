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
    shape: 'rect',
    onShape: vi.fn(),
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
    expect(screen.getByRole('dialog', { name: '펜' })).toBeInTheDocument()
    expect(props.onTool).not.toHaveBeenCalled()
  })

  test('다른 도구일 때 펜을 누르면 펜으로 바뀌기만 한다', async () => {
    const props = setup({ tool: 'eraser' })
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

describe('잉크(색)', () => {
  const openInk = () => userEvent.click(screen.getByRole('button', { name: /^잉크:/ }))

  test('도구 막대에는 지금 고른 잉크 하나만 보인다', () => {
    setup({ noteColors: ['#16794f', '#8b5cf6'], ink: '#8b5cf6' })
    expect(screen.getByRole('button', { name: '잉크: 노트 색 #8b5cf6' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '잉크 파랑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '노트 색 #16794f' })).not.toBeInTheDocument()
  })

  test('잉크 창에서 기본 잉크와 노트 색을 고른다. 고르면 창이 닫힌다', async () => {
    const props = setup({ noteColors: ['#16794f', '#8b5cf6'], ink: '#8b5cf6' })
    await openInk()
    expect(screen.getByRole('dialog', { name: '잉크' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '잉크 파랑' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '노트 색 #8b5cf6' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '노트 색 #16794f' }))
    expect(props.onInk).toHaveBeenCalledWith('#16794f')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('새 색 만들기로 색 코드를 넣어 노트 색으로 더한다', async () => {
    const props = setup()
    await openInk()
    await userEvent.click(screen.getByRole('button', { name: '+ 새 색 만들기' }))
    expect(screen.getByRole('dialog', { name: '새 색 만들기' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: '색 코드' })
    await userEvent.clear(input)
    await userEvent.type(input, '#12AB34')
    await userEvent.click(screen.getByRole('button', { name: '이 색 더하기' }))
    expect(props.onAddColor).toHaveBeenCalledWith('#12ab34')
    expect(props.onInk).toHaveBeenCalledWith('#12ab34')
  })

  test('새 색 만들기에서 뒤로 가면 잉크 목록으로 돌아간다', async () => {
    setup()
    await openInk()
    await userEvent.click(screen.getByRole('button', { name: '+ 새 색 만들기' }))
    await userEvent.click(screen.getByRole('button', { name: '잉크 목록으로' }))
    expect(screen.getByRole('dialog', { name: '잉크' })).toBeInTheDocument()
  })

  test('추천 색을 누르면 그 색이 골라진다', async () => {
    const props = setup()
    await openInk()
    await userEvent.click(screen.getByRole('button', { name: '+ 새 색 만들기' }))
    await userEvent.click(screen.getByRole('button', { name: '추천 색 #0e7490' }))
    expect(screen.getByRole('textbox', { name: '색 코드' })).toHaveValue('#0e7490')
    await userEvent.click(screen.getByRole('button', { name: '이 색 더하기' }))
    expect(props.onAddColor).toHaveBeenCalledWith('#0e7490')
  })

  test('형식이 틀린 색 코드는 더할 수 없다', async () => {
    setup()
    await openInk()
    await userEvent.click(screen.getByRole('button', { name: '+ 새 색 만들기' }))
    const input = screen.getByRole('textbox', { name: '색 코드' })
    await userEvent.clear(input)
    await userEvent.type(input, '#12')
    expect(screen.getByRole('button', { name: '이 색 더하기' })).toBeDisabled()
  })

  test('노트 색이 가득 차면 더하기 대신 안내를 본다', async () => {
    setup({ noteColors: ['#000001', '#000002', '#000003', '#000004', '#000005', '#000006', '#000007', '#000008'] })
    await openInk()
    await userEvent.click(screen.getByRole('button', { name: '+ 새 색 만들기' }))
    expect(screen.getByRole('button', { name: '이 색 더하기' })).toBeDisabled()
    expect(screen.getByText(/8개까지/)).toBeInTheDocument()
  })

  test('새 색 만들기에서 노트 색을 뺄 수 있다', async () => {
    const onRemoveColor = vi.fn()
    setup({ noteColors: ['#16794f'], onRemoveColor })
    await openInk()
    await userEvent.click(screen.getByRole('button', { name: '+ 새 색 만들기' }))
    await userEvent.click(screen.getByRole('button', { name: '노트 색 #16794f 빼기' }))
    expect(onRemoveColor).toHaveBeenCalledWith('#16794f')
  })
})

test('레이어 버튼으로 레이어 패널을 열고 닫는다', async () => {
  setup({ layerPanel: <p>패널 내용</p> })
  await userEvent.click(screen.getByRole('button', { name: '레이어' }))
  expect(screen.getByRole('dialog', { name: '레이어' })).toHaveTextContent('패널 내용')
  await userEvent.click(screen.getByRole('button', { name: '레이어' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

describe('도형', () => {
  test('다른 도구일 때 도형을 누르면 도형 도구로 바뀐다', async () => {
    const props = setup({ tool: 'pen' })
    await userEvent.click(screen.getByRole('button', { name: '도형 (사각형)' }))
    expect(props.onTool).toHaveBeenCalledWith('shape')
  })

  test('도형 도구일 때 다시 누르면 도형 종류를 고를 수 있다', async () => {
    const props = setup({ tool: 'shape', shape: 'rect' })
    await userEvent.click(screen.getByRole('button', { name: '도형 (사각형)' }))
    const dialog = screen.getByRole('dialog', { name: '도형' })
    expect(dialog).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^곡선:/ }))
    expect(props.onShape).toHaveBeenCalledWith('curve')
    expect(screen.queryByRole('dialog', { name: '도형' })).not.toBeInTheDocument()
  })
})

describe('도구 막대 옮기기', () => {
  test('손잡이에서 화살표 키로 붙일 가장자리를 바꾼다', async () => {
    const onDock = vi.fn()
    setup({ dock: 'left', onDock })
    const grip = screen.getByRole('button', { name: '도구 막대 옮기기' })
    grip.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onDock).toHaveBeenLastCalledWith('right')
    await userEvent.keyboard('{ArrowUp}')
    expect(onDock).toHaveBeenLastCalledWith('top')
    await userEvent.keyboard('{ArrowDown}')
    expect(onDock).toHaveBeenLastCalledWith('bottom')
  })

  test('옮기기를 받지 않으면 손잡이가 없다', () => {
    setup()
    expect(screen.queryByRole('button', { name: '도구 막대 옮기기' })).not.toBeInTheDocument()
  })

  test('붙인 가장자리를 알린다(가로 막대 모양은 CSS가 고른다)', () => {
    setup({ dock: 'top', onDock: vi.fn() })
    expect(screen.getByRole('navigation', { name: '도구' })).toHaveAttribute('data-dock', 'top')
  })
})

describe('형광펜(펜 버튼 안)', () => {
  test('도구 막대에 형광펜 버튼은 따로 없다', () => {
    setup()
    expect(screen.queryByRole('button', { name: /^형광펜/ })).not.toBeInTheDocument()
  })

  test('펜 창에서 형광펜을 고르면 형광펜으로 바꾸고 창을 닫는다', async () => {
    const props = setup({ tool: 'pen' })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    await userEvent.click(screen.getByRole('button', { name: /^형광펜/ }))
    expect(props.onTool).toHaveBeenCalledWith('highlighter')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('형광펜일 때 펜 버튼은 형광펜으로 보이고, 다시 누르면 창이 열려 형광펜이 골라져 있다', async () => {
    const props = setup({ tool: 'highlighter' })
    const pen = screen.getByRole('button', { name: '펜 (형광펜)' })
    expect(pen).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(pen)
    expect(props.onTool).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^형광펜/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^볼펜/ })).toHaveAttribute('aria-pressed', 'false')
  })

  test('펜 종류를 고르면 형광펜에서 펜으로 돌아간다', async () => {
    const props = setup({ tool: 'highlighter' })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    await userEvent.click(screen.getByRole('button', { name: /^연필/ }))
    expect(props.onBrush).toHaveBeenCalledWith('pencil')
    expect(props.onTool).toHaveBeenCalledWith('pen')
  })
})

describe('굵기(버튼 하나)', () => {
  test('굵기 버튼을 열어 기본 굵기를 고른다', async () => {
    const props = setup({ widthLevel: 1 })
    await userEvent.click(screen.getByRole('button', { name: '굵기: 보통' }))
    await userEvent.click(screen.getByRole('button', { name: /굵게/ }))
    expect(props.onWidth).toHaveBeenCalledWith(2)
  })

  test('굵기 창에서 px로 굵기를 넣는다(1~80으로 맞춘다)', async () => {
    const onCustomWidth = vi.fn()
    setup({ customWidth: null, onCustomWidth })
    await userEvent.click(screen.getByRole('button', { name: /^굵기:/ }))
    const input = screen.getByRole('spinbutton', { name: '굵기(px)' })
    await userEvent.clear(input)
    await userEvent.type(input, '18{Enter}')
    expect(onCustomWidth).toHaveBeenLastCalledWith(18)
    await userEvent.clear(input)
    await userEvent.type(input, '500{Enter}')
    expect(onCustomWidth).toHaveBeenLastCalledWith(80)
  })

  test('직접 정한 굵기가 있으면 버튼에 px가 보이고 기본 굵기는 골라져 보이지 않는다', async () => {
    setup({ widthLevel: 1, customWidth: 18, onCustomWidth: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: '굵기: 18px' }))
    expect(screen.getByRole('button', { name: /보통/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('펜 전용 모드(손가락 설정)', () => {
  test('펜 창에서 자동·켬·끔을 고르면 알린다', async () => {
    const onPenOnly = vi.fn()
    setup({ tool: 'pen', penOnly: 'auto', onPenOnly })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    expect(screen.getByRole('radio', { name: /^손가락 자동/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /^손가락 켬/ }))
    expect(onPenOnly).toHaveBeenCalledWith('on')
  })

  test('설정을 받지 않으면 보이지 않는다', async () => {
    setup({ tool: 'pen' })
    await userEvent.click(screen.getByRole('button', { name: /^펜/ }))
    expect(screen.queryByRole('radiogroup', { name: '손가락' })).not.toBeInTheDocument()
  })
})

describe('지우개 크기', () => {
  test('지우개를 들면 굵기 버튼이 지우개 크기가 되고, 단계를 고르면 알린다', async () => {
    const onEraserLevel = vi.fn()
    setup({ tool: 'eraser', eraserLevel: 1, eraserWidth: null, onEraserLevel, onEraserWidth: vi.fn() })
    expect(screen.queryByRole('button', { name: /^굵기:/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '지우개 크기: 보통' }))
    await userEvent.click(screen.getByRole('button', { name: /크게/ }))
    expect(onEraserLevel).toHaveBeenCalledWith(2)
  })

  test('지우개 크기를 px로 넣는다', async () => {
    const onEraserWidth = vi.fn()
    setup({ tool: 'eraser', eraserLevel: 1, eraserWidth: 30, onEraserLevel: vi.fn(), onEraserWidth })
    await userEvent.click(screen.getByRole('button', { name: '지우개 크기: 30px' }))
    const input = screen.getByRole('spinbutton', { name: '굵기(px)' })
    await userEvent.clear(input)
    await userEvent.type(input, '12{Enter}')
    expect(onEraserWidth).toHaveBeenLastCalledWith(12)
  })

  test('펜으로 돌아오면 굵기 버튼은 획 굵기다', () => {
    setup({ tool: 'pen', widthLevel: 0, eraserLevel: 2, onEraserLevel: vi.fn() })
    expect(screen.getByRole('button', { name: '굵기: 가늘게' })).toBeInTheDocument()
  })
})

describe('채색 붓', () => {
  const paintProps = { paintLevel: 1 as const, paintWidth: null, onPaintLevel: vi.fn(), onPaintWidth: vi.fn(), paintOpacity: 0.6, onPaintOpacity: vi.fn(), paintSoft: false, onPaintSoft: vi.fn() }

  test('채색 버튼을 누르면 채색 도구가 되고, 다시 누르면 불투명도·부드러움 창이 열린다', async () => {
    const props = setup({ tool: 'pen', ...paintProps })
    await userEvent.click(screen.getByRole('button', { name: '채색' }))
    expect(props.onTool).toHaveBeenCalledWith('paint')
  })

  test('채색 창에서 불투명도 단계·밀대·부드러운 가장자리를 바꾼다', async () => {
    const onPaintOpacity = vi.fn()
    const onPaintSoft = vi.fn()
    setup({ tool: 'paint', ...paintProps, onPaintOpacity, onPaintSoft })
    await userEvent.click(screen.getByRole('button', { name: '채색' }))
    expect(screen.getByRole('dialog', { name: '채색' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '보통' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '진하게' }))
    expect(onPaintOpacity).toHaveBeenCalledWith(1)
    await userEvent.click(screen.getByRole('checkbox', { name: '부드러운 가장자리' }))
    expect(onPaintSoft).toHaveBeenCalledWith(true)
  })

  test('채색일 때 굵기 버튼은 채색 굵기(최대 200px)를 다룬다', async () => {
    const onPaintWidth = vi.fn()
    setup({ tool: 'paint', ...paintProps, paintWidth: 120, onPaintWidth })
    await userEvent.click(screen.getByRole('button', { name: '굵기: 120px' }))
    const input = screen.getByRole('spinbutton', { name: '굵기(px)' })
    await userEvent.clear(input)
    await userEvent.type(input, '500{Enter}')
    expect(onPaintWidth).toHaveBeenLastCalledWith(200)
  })

  test('채색 설정이 없으면 채색 버튼을 보이지 않는다', () => {
    setup({ tool: 'pen' })
    expect(screen.queryByRole('button', { name: '채색' })).not.toBeInTheDocument()
  })
})

describe('도형 채움', () => {
  test('도형 창에서 채움 단계를 고른다', async () => {
    const onShapeFill = vi.fn()
    setup({ tool: 'shape', shapeFill: 0, onShapeFill })
    await userEvent.click(screen.getByRole('button', { name: /^도형/ }))
    expect(screen.getByRole('button', { name: '없음' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '보통' }))
    expect(onShapeFill).toHaveBeenCalledWith(0.6)
  })
})

describe('채색 팔레트·최근 색·스포이트', () => {
  test('잉크 창에 채색 팔레트와 최근 색이 보이고 고르면 잉크가 된다', async () => {
    const props = setup({ recentInks: ['#123456'], onEyedropper: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: /^잉크:/ }))
    await userEvent.click(screen.getByRole('button', { name: '민트' }))
    expect(props.onInk).toHaveBeenCalledWith('#A8E0CE')
    await userEvent.click(screen.getByRole('button', { name: /^잉크:/ }))
    await userEvent.click(screen.getByRole('button', { name: '최근 노트 색 #123456' }))
    expect(props.onInk).toHaveBeenCalledWith('#123456')
  })

  test('스포이트를 누르면 창이 닫히고 알린다', async () => {
    const onEyedropper = vi.fn()
    setup({ onEyedropper })
    await userEvent.click(screen.getByRole('button', { name: /^잉크:/ }))
    await userEvent.click(screen.getByRole('button', { name: /스포이트/ }))
    expect(onEyedropper).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '잉크' })).not.toBeInTheDocument()
  })
})
