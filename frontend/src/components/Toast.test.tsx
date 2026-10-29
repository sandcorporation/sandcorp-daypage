import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useToast } from './Toast'

test('버튼 달린 알림: 누르면 할 일을 부르고 알림을 닫는다', () => {
  const onClick = vi.fn()
  const hook = renderHook(() => useToast())
  act(() => hook.result.current.show('획 3개를 지웠어요.', { label: '되돌리기', onClick }))
  const view = render(<>{hook.result.current.toast}</>)
  fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
  expect(onClick).toHaveBeenCalledTimes(1)
  view.rerender(<>{hook.result.current.toast}</>)
  expect(screen.queryByRole('status')).toBeNull()
})
