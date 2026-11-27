import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

test('알림의 단추를 누르면 알림이 사라져도 초점이 오기 전 자리로 돌아간다', async () => {
  function Harness() {
    const { toast, show } = useToast()
    return (
      <>
        <button type="button" onClick={() => show('지웠어요', { label: '되돌리기', onClick: () => {} })}>
          지우기
        </button>
        {toast}
      </>
    )
  }
  render(<Harness />)
  const remove = screen.getByRole('button', { name: '지우기' })
  await userEvent.click(remove)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  expect(screen.queryByRole('status')).toBeNull()
  expect(document.activeElement).not.toBe(document.body)
  expect(remove).toHaveFocus()
})
