import { placeCursorLabel } from './cursorLabel'

const box = { x: 200, y: 100, width: 300, height: 96 }

test('커서가 글 상자 밖이면 꼬리표는 커서 옆 그대로', () => {
  expect(placeCursorLabel({ x: 50, y: 50 }, [box])).toEqual({ x: 50, y: 50, side: 'cursor' })
})

test('커서가 글 상자 위에 있으면 꼬리표를 상자 오른쪽 바깥으로 민다', () => {
  expect(placeCursorLabel({ x: 260, y: 130 }, [box])).toEqual({ x: 508, y: 130, side: 'right' })
})

test('상자가 장 오른쪽 끝에 붙어 있으면 왼쪽 바깥으로 민다', () => {
  const edge = { x: 1300, y: 100, width: 290, height: 64 }
  expect(placeCursorLabel({ x: 1400, y: 120 }, [edge])).toEqual({ x: 1292, y: 120, side: 'left' })
})

test('그 사람이 편집 중인 상자 위라면 꼬리표를 숨긴다(이어 쓰는 중 표시가 이미 닉네임을 보여 줌)', () => {
  const editing = { ...box, id: 'b1' }
  expect(placeCursorLabel({ x: 260, y: 130 }, [editing], 'b1')).toEqual({ x: 260, y: 130, side: 'hidden' })
  expect(placeCursorLabel({ x: 260, y: 130 }, [editing], 'other').side).toBe('right')
})
