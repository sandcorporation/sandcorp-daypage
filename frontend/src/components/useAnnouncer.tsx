import { useCallback, useState } from 'react'

/**
 * 눈에 안 보이는 live 영역. 화면은 이미 바뀐 것이 보이고, 화면 낭독기에는 아무 글도 없는 동작을 알린다.
 * node는 동작하는 단추와 함께 늘 그려 둔다(글과 함께 새로 생긴 영역은 읽지 않을 수 있다).
 */
export function useAnnouncer() {
  const [message, setMessage] = useState({ text: '', turn: 0 })
  const announce = useCallback((text: string) => setMessage((m) => ({ text, turn: m.turn + 1 })), [])
  // 같은 글이 이어져도 다시 읽도록 번갈아 끝에 빈칸을 붙인다
  const node = (
    <p className="visually-hidden" role="status">
      {message.text}
      {message.turn % 2 === 0 && message.text ? ' ' : ''}
    </p>
  )
  return { node, announce }
}
