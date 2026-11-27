import { focusSpot } from './focusSpot'

test('초점을 받을 수 없는 자리에 초점을 두고, 떠나면 tabIndex를 거둔다', () => {
  document.body.innerHTML = '<div></div><button>다음</button>'
  const spot = document.querySelector('div')!
  focusSpot(spot)
  expect(spot).toHaveFocus()
  document.querySelector('button')!.focus()
  expect(spot).not.toHaveAttribute('tabindex')
})
