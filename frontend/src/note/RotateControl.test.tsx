import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { DEFAULT_KEYMAP } from '../page/shortcuts'
import { VIEW_IDENTITY, rotateView } from '../page/viewTransform'
import { RotateControl } from './RotateControl'

const noop = () => {}

test('#275 원위치 단추는 눌림(pressed)이 아니라 설명으로 돌아가 있는지 말한다', () => {
  const control = (view = VIEW_IDENTITY) => <RotateControl view={view} keymap={DEFAULT_KEYMAP} onRotate={noop} onMirror={noop} onReset={noop} />
  const { rerender } = render(control())
  const reset = screen.getByRole('button', { name: '돌리기·뒤집기 원위치' })
  expect(reset).not.toHaveAttribute('aria-pressed')
  expect(reset).toHaveAccessibleDescription('지금 원위치예요')

  rerender(control(rotateView(VIEW_IDENTITY, 1)))
  expect(reset).not.toHaveAttribute('aria-pressed')
  expect(reset).toHaveAccessibleDescription('보기가 돌아가거나 뒤집혀 있어요')
})
