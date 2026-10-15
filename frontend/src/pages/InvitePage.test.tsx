import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { InvitePage } from './InvitePage'

function renderInvite(props: Partial<Parameters<typeof InvitePage>[0]> = {}) {
  return render(
    <MemoryRouter>
      <InvitePage noteId="abc" noteName="우리집 공용 노트" online={3} isFull={false} {...props} />
    </MemoryRouter>,
  )
}

test('로그인 버튼은 카카오 로그인 후 같은 노트로 돌아오게 한다', () => {
  renderInvite()
  const link = screen.getByRole('link', { name: /카카오로 로그인하고 참여하기/ })
  expect(link).toHaveAttribute('href', '/auth/kakao/login?next=%2Fnote%2Fabc')
  expect(screen.getByText(/지금 3명이/)).toBeInTheDocument()
})

test('정원이 찬 노트는 로그인 버튼 대신 안내를 보여준다', () => {
  renderInvite({ isFull: true })
  expect(screen.queryByRole('link', { name: /카카오로 로그인/ })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('정원이 찼어요')
})
