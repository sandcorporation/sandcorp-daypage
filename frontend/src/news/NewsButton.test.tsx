import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewsButton } from './NewsButton'
import type { NewsEntry } from './news'

const entries: NewsEntry[] = [
  { id: 'b', date: '10월 19일', items: [{ kind: 'new', title: '200% 확대', text: '크게 봐요' }] },
  { id: 'a', date: '10월 16일', items: [{ kind: 'fix', text: '고친 것' }] },
]

beforeEach(() => localStorage.clear())

test('안 본 소식이 있으면 점이 보이고, 열면 사라진다', async () => {
  localStorage.setItem('daypage:news-seen', 'a')
  render(<NewsButton entries={entries} />)
  const button = screen.getByRole('button', { name: /새 소식/ })
  expect(button).toHaveAccessibleName('새 소식 (읽지 않은 소식 있음)')
  await userEvent.click(button)
  expect(screen.getByRole('dialog', { name: '새 소식' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /새 소식/ })).toHaveAccessibleName('새 소식')
  expect(localStorage.getItem('daypage:news-seen')).toBe('b')
})

test('창에는 날짜별 소식과 꼬리표, 처음 보는 소식 표시가 나온다', async () => {
  localStorage.setItem('daypage:news-seen', 'a')
  render(<NewsButton entries={entries} />)
  await userEvent.click(screen.getByRole('button', { name: /새 소식/ }))
  const dialog = screen.getByRole('dialog', { name: '새 소식' })
  expect(dialog).toHaveTextContent('10월 19일')
  expect(dialog).toHaveTextContent('처음 보는 소식')
  expect(dialog).toHaveTextContent('새 기능')
  expect(dialog).toHaveTextContent('200% 확대')
  expect(dialog).toHaveTextContent('10월 16일')
  expect(dialog).toHaveTextContent('고침')
  // 처음 보는 표시는 새 소식에만
  expect(screen.getAllByText('처음 보는 소식')).toHaveLength(1)
})

test('다 본 뒤에는 점이 없다', () => {
  localStorage.setItem('daypage:news-seen', 'b')
  render(<NewsButton entries={entries} />)
  expect(screen.getByRole('button', { name: /새 소식/ })).toHaveAccessibleName('새 소식')
})

test('창 아래쪽에 개인정보·오류 기록 링크가 있다', async () => {
  render(<NewsButton entries={entries} />)
  await userEvent.click(screen.getByRole('button', { name: /새 소식/ }))
  const link = screen.getByRole('link', { name: '개인정보·오류 기록' })
  expect(link).toHaveAttribute('href', 'https://sandcorporation.github.io/privacy-and-terms/errors/')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener')
})
