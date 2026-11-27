import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ZoomControl } from './ZoomControl'

test.each([
  ['축소', 0.35],
  ['확대', 2],
])('‘%s’가 끝에 닿아도 초점이 남고 누름은 무시한다', async (name, scale) => {
  const onZoom = vi.fn()
  render(<ZoomControl scale={scale} zoom={scale} onZoom={onZoom} />)
  const button = screen.getByRole('button', { name })
  // disabled면 브라우저가 초점을 body로 보낸다(jsdom은 그러지 않아 속성으로 본다)
  expect(button).not.toBeDisabled()
  expect(button).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(button)
  expect(button).toHaveFocus()
  expect(onZoom).not.toHaveBeenCalled()
})
