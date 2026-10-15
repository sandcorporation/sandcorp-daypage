import { uniquePeople } from './usePresence'
import type { Peer } from './types'

const peer = (clientId: number, nickname: string, isMe = false): Peer => ({
  clientId,
  nickname,
  color: '#000',
  cursor: null,
  editingBoxId: null,
  isMe,
})

test('같은 사람의 여러 탭은 아바타 하나로 묶고 나는 뺀다', () => {
  const people = uniquePeople([peer(1, '졸린 수달', true), peer(2, '푸른 펭귄'), peer(3, '푸른 펭귄'), peer(4, '용감한 고구마')])
  expect(people.map((p) => p.nickname)).toEqual(['푸른 펭귄', '용감한 고구마'])
})
