import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

function Harness({ removeOpener = false, busy = false }: { removeOpener?: boolean; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState(false)
  const near = useRef<HTMLButtonElement>(null)
  return (
    <>
      {!gone && (
        <button type="button" onClick={() => setOpen(true)}>
          열기
        </button>
      )}
      <button type="button" ref={near}>
        뒤 페이지
      </button>
      {open && (
        <ConfirmDialog
          title="지울까요?"
          confirmLabel="삭제"
          busy={busy}
          fallbackFocus={() => near.current}
          onConfirm={() => {
            if (removeOpener) setGone(true)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        >
          <p>되돌릴 수 없어요.</p>
        </ConfirmDialog>
      )}
    </>
  )
}

const button = (name: string) => screen.getByRole('button', { name })

async function open() {
  await userEvent.click(button('열기'))
}

test('Tab과 Shift+Tab이 확인 창 안에서 돈다', async () => {
  render(<Harness />)
  await open()
  expect(button('취소')).toHaveFocus()
  await userEvent.tab()
  expect(button('삭제')).toHaveFocus()
  await userEvent.tab()
  expect(button('취소')).toHaveFocus()
  await userEvent.tab({ shift: true })
  expect(button('삭제')).toHaveFocus()
})

test('누를 수 있는 단추가 없으면 Tab을 눌러도 초점이 창에 머문다', async () => {
  render(<Harness busy />)
  await open()
  await userEvent.tab()
  expect(screen.getByRole('alertdialog')).toHaveFocus()
})

test.each(['{Escape}', '{Enter}'])('%s로 닫으면 초점이 연 단추로 돌아온다', async (key) => {
  render(<Harness />)
  await open()
  await userEvent.keyboard(key)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(button('열기')).toHaveFocus()
})

test('연 단추가 사라지면 근처 자리로 간다', async () => {
  render(<Harness removeOpener />)
  await open()
  await userEvent.click(button('삭제'))
  expect(button('뒤 페이지')).toHaveFocus()
})

test('Escape는 뒤에 열린 창까지 닫지 않는다', async () => {
  const outer = vi.fn()
  window.addEventListener('keydown', outer)
  render(<Harness />)
  await open()
  await userEvent.keyboard('{Escape}')
  expect(outer).not.toHaveBeenCalled()
  window.removeEventListener('keydown', outer)
})
