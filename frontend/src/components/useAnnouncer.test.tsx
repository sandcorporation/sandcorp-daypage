import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAnnouncer } from './useAnnouncer'

test('같은 글을 이어서 알려도 영역의 글이 바뀐다', async () => {
  function Harness() {
    const { node, announce } = useAnnouncer()
    return (
      <>
        <button type="button" onClick={() => announce('되돌렸어요')}>
          되돌리기
        </button>
        {node}
      </>
    )
  }
  render(<Harness />)
  const region = screen.getByRole('status')
  const button = screen.getByRole('button')
  await userEvent.click(button)
  const first = region.textContent
  await userEvent.click(button)
  expect(region.textContent).not.toBe(first)
  expect(region.textContent?.trim()).toBe('되돌렸어요')
})
