import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WebsocketProvider } from 'y-websocket'
import type { Point } from '../page/geometry'
import type { Peer } from './types'

type State = {
  nickname?: string
  color?: string
  cursor?: { x: number; y: number } | null
  editingBoxId?: string | null
}

// 커서 위치를 보내는 최소 간격(ms). 받는 쪽은 CSS 전환으로 이어 붙여 부드럽게 보인다(.peer-cursor).
const CURSOR_INTERVAL = 100

/** 접속자들의 커서·닉네임·편집 중 상자. 닉네임·색은 서버가 덮어쓴 값을 쓴다. */
export function usePresence(provider: WebsocketProvider | null, me: { nickname: string; color: string }) {
  const [peers, setPeers] = useState<Peer[]>([])
  const lastSent = useRef(0)
  const pending = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!provider) return
    const awareness = provider.awareness
    awareness.setLocalState({ nickname: me.nickname, color: me.color, cursor: null, editingBoxId: null })
    const read = () => {
      const list: Peer[] = []
      awareness.getStates().forEach((raw, clientId) => {
        const s = raw as State
        if (!s.nickname) return
        list.push({
          clientId,
          nickname: s.nickname,
          color: s.color ?? '#5E6270',
          cursor: s.cursor ?? null,
          editingBoxId: s.editingBoxId ?? null,
          isMe: clientId === awareness.clientID,
        })
      })
      setPeers(list)
    }
    read()
    awareness.on('change', read)
    return () => {
      awareness.off('change', read)
      window.clearTimeout(pending.current)
    }
  }, [provider, me.nickname, me.color])

  const setCursor = useCallback(
    (p: Point | null) => {
      if (!provider) return
      const send = () => {
        lastSent.current = Date.now()
        provider.awareness.setLocalStateField('cursor', p ? { x: Math.round(p.x), y: Math.round(p.y) } : null)
      }
      window.clearTimeout(pending.current)
      const wait = CURSOR_INTERVAL - (Date.now() - lastSent.current)
      if (wait <= 0 || p === null) send()
      else pending.current = window.setTimeout(send, wait)
    },
    [provider],
  )

  const setEditing = useCallback(
    (boxId: string | null) => provider?.awareness.setLocalStateField('editingBoxId', boxId),
    [provider],
  )

  const editors = useMemo(() => {
    const map = new Map<string, { nickname: string; color: string }[]>()
    for (const p of peers) {
      if (p.isMe || !p.editingBoxId) continue
      map.set(p.editingBoxId, [...(map.get(p.editingBoxId) ?? []), { nickname: p.nickname, color: p.color }])
    }
    return map
  }, [peers])

  return { peers, setCursor, setEditing, editors }
}

/** 같은 사람이 여러 탭으로 들어와도 아바타는 하나만. 내 다른 탭도 뺀다. */
export function uniquePeople(peers: Peer[], myNickname?: string): Peer[] {
  const seen = new Set<string>(myNickname ? [myNickname] : [])
  return peers.filter((p) => !p.isMe && !seen.has(p.nickname) && seen.add(p.nickname))
}
