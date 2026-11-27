import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AppRoutes } from './AppRoutes'

afterEach(() => vi.unstubAllGlobals())

test('없는 주소는 찾을 수 없어요 화면과 첫 화면으로 링크를 보여준다', () => {
  render(
    <MemoryRouter initialEntries={['/no-such-page']}>
      <AppRoutes />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { name: '노트를 찾을 수 없어요' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '첫 화면으로' })).toHaveAttribute('href', '/')
})

test('노트를 여는 동안 불러오는 중을 알린다', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  render(
    <MemoryRouter initialEntries={['/note/abc']}>
      <AppRoutes />
    </MemoryRouter>,
  )
  expect(screen.getByRole('status')).toHaveTextContent('불러오는 중')
})
