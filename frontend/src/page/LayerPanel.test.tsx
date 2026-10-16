import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps } from 'react'
import * as Y from 'yjs'
import { addStroke, createPageDoc, type Stroke } from './doc'
import { addLayer, BASE_LAYER_ID, MAX_LAYERS, readLayers } from './layers'
import { LayerPanel } from './LayerPanel'

function stroke(partial: Partial<Stroke>): Stroke {
  return { id: 's', tool: 'pen', color: '#000000', width: 6, points: [0, 0, 0.5], author: '졸린 수달', createdAt: 0, ...partial }
}

type Props = ComponentProps<typeof LayerPanel>

function setup(doc: Y.Doc, over: Partial<Props> = {}) {
  const props: Props = {
    doc,
    current: readLayers(doc).at(-1)!.id,
    onCurrent: vi.fn(),
    hidden: new Set(),
    onToggleHidden: vi.fn(),
    ...over,
  }
  render(<LayerPanel {...props} />)
  return props
}

const rows = () => screen.getAllByRole('listitem')

/** 레이어를 고르는 버튼 이름: '레이어 1' 또는 '레이어 1 (지금 그리는 레이어)' */
const pick = (name: string) => (accessible: string) => accessible === name || accessible.startsWith(`${name} (`)

describe('레이어 목록', () => {
  test('처음에는 기본 레이어 하나와 획 수·그린 사람이 보인다', () => {
    const doc = createPageDoc('2026-10-16')
    addStroke(doc, stroke({ id: 'a' }))
    addStroke(doc, stroke({ id: 'b', author: '푸른 펭귄' }))
    setup(doc)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('레이어 1')
    expect(rows()[0]).toHaveTextContent('획 2개')
    expect(rows()[0]).toHaveTextContent('졸린 수달, 푸른 펭귄')
  })

  test('위에 있는 레이어가 목록 위에 보이고, 지금 그리는 레이어가 표시된다', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    setup(doc, { current: top })
    expect(rows().map((r) => within(r).getByText(/^레이어 \d$/).textContent)).toEqual(['레이어 2', '레이어 1'])
    expect(within(rows()[0]).getByRole('button', { name: pick('레이어 2') })).toHaveAttribute('aria-pressed', 'true')
  })

  test('레이어를 누르면 지금 그리는 레이어로 고른다', async () => {
    const doc = createPageDoc('2026-10-16')
    addLayer(doc)
    const props = setup(doc)
    await userEvent.click(screen.getByRole('button', { name: pick('레이어 1') }))
    expect(props.onCurrent).toHaveBeenCalledWith(BASE_LAYER_ID)
  })

  test('새 레이어를 만들면 목록에 생기고 지금 그리는 레이어가 된다', async () => {
    const doc = createPageDoc('2026-10-16')
    const props = setup(doc)
    await userEvent.click(screen.getByRole('button', { name: '+ 새 레이어' }))
    expect(rows()).toHaveLength(2)
    expect(props.onCurrent).toHaveBeenCalledWith(readLayers(doc)[1].id)
  })

  test(`${MAX_LAYERS}개가 되면 더 만들 수 없다`, () => {
    const doc = createPageDoc('2026-10-16')
    for (let i = 1; i < MAX_LAYERS; i++) addLayer(doc)
    setup(doc)
    expect(screen.getByRole('button', { name: '+ 새 레이어' })).toBeDisabled()
    expect(screen.getByText(new RegExp(`${MAX_LAYERS}개까지`))).toBeInTheDocument()
  })

  test('다른 사람이 레이어를 만들면 목록이 바로 바뀐다', () => {
    const doc = createPageDoc('2026-10-16')
    setup(doc)
    act(() => void addLayer(doc))
    expect(rows()).toHaveLength(2)
  })
})

describe('이름·순서·숨기기·불투명도', () => {
  test('눈을 누르면 내 화면에서 숨긴다(문서는 그대로)', async () => {
    const doc = createPageDoc('2026-10-16')
    const before = Y.encodeStateAsUpdate(doc)
    const props = setup(doc)
    await userEvent.click(screen.getByRole('button', { name: '레이어 1 숨기기' }))
    expect(props.onToggleHidden).toHaveBeenCalledWith(BASE_LAYER_ID)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  test('숨긴 레이어는 보이기 버튼으로 바뀌고 흐리게 보인다', () => {
    const doc = createPageDoc('2026-10-16')
    setup(doc, { hidden: new Set([BASE_LAYER_ID]) })
    expect(screen.getByRole('button', { name: '레이어 1 보이기' })).toBeInTheDocument()
    expect(rows()[0]).toHaveTextContent('내 화면에서 숨김')
  })

  test('이름을 바꾼다(Enter로 저장, Esc로 취소)', async () => {
    const doc = createPageDoc('2026-10-16')
    setup(doc)
    await userEvent.click(screen.getByRole('button', { name: '레이어 1 이름 바꾸기' }))
    const input = screen.getByRole('textbox', { name: '레이어 이름' })
    await userEvent.clear(input)
    await userEvent.type(input, '밑그림{Enter}')
    expect(readLayers(doc)[0].name).toBe('밑그림')
    await userEvent.click(screen.getByRole('button', { name: '밑그림 이름 바꾸기' }))
    await userEvent.type(screen.getByRole('textbox', { name: '레이어 이름' }), '엉뚱{Escape}')
    expect(readLayers(doc)[0].name).toBe('밑그림')
  })

  test('지금 그리는 레이어의 불투명도를 바꾼다', () => {
    const doc = createPageDoc('2026-10-16')
    setup(doc)
    const slider = screen.getByRole('slider', { name: '불투명도' })
    act(() => {
      fireEvent.change(slider, { target: { value: '40' } })
    })
    expect(readLayers(doc)[0].opacity).toBe(0.4)
  })

  test('끌어서 놓으면 순서가 바뀐다', () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    setup(doc)
    const [topRow, baseRow] = rows()
    act(() => {
      fireEvent.dragStart(baseRow)
      fireEvent.dragOver(topRow)
      fireEvent.drop(topRow)
    })
    expect(readLayers(doc).map((l) => l.id)).toEqual([top, BASE_LAYER_ID])
  })

  test('키보드로 위·아래로 옮긴다(Alt+화살표)', async () => {
    const doc = createPageDoc('2026-10-16')
    const top = addLayer(doc)!
    setup(doc)
    screen.getByRole('button', { name: pick('레이어 1') }).focus()
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(readLayers(doc).map((l) => l.id)).toEqual([top, BASE_LAYER_ID])
  })
})

describe('잠그기', () => {
  test('자물쇠로 잠그고 풀면 문서에 반영되고, 잠김이 보인다', async () => {
    const doc = createPageDoc('2026-10-16')
    setup(doc)
    await userEvent.click(screen.getByRole('button', { name: '레이어 1 잠그기' }))
    expect(readLayers(doc)[0].locked).toBe(true)
    expect(rows()[0]).toHaveTextContent('잠김')
    await userEvent.click(screen.getByRole('button', { name: '레이어 1 잠금 풀기' }))
    expect(readLayers(doc)[0].locked).toBe(false)
  })
})
