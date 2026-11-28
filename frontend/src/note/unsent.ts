import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { WebsocketProvider } from 'y-websocket'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'

/**
 * 서버에 닿지 않은 내 변경(#250, #258). y-websocket은 받았다는 답을 주지 않고, 말없이 죽은 소켓은 한참 뒤에야
 * 끊김으로 바뀐다. 그래서 연결이 맞춰진(live) 동안 낸 갱신도 서버가 받았다고 확인될 때까지 남은 것으로 센다.
 * `edits`는 이 장에서 낸 내 갱신 수, `confirmed`는 그중 서버에 닿았다고 확인된 수다.
 */
export type Unsent = { live: boolean; edits: number; confirmed: number }

export type UnsentEvent =
  /** 연결이 맞춰졌는지(연결됨 + 서버와 sync)가 바뀌었다 */
  | { type: 'live'; live: boolean }
  /** 내가 문서를 고쳤다 */
  | { type: 'local' }
  /** 서버가 보낸 남의 갱신 */
  | { type: 'remote' }
  /** 서버가 내 갱신 `upTo`개째까지를 받았다(그 뒤에 보낸 sync step1에 답했다) */
  | { type: 'confirmed'; upTo: number }

/** 화면이 지금 문서를 쓰는 노트인지. 장 교체·읽기 전용·막힘(오류·대기열) 화면에서는 경고하지 않는다. */
export type UnsentScreen = { switching: boolean; readOnly: boolean; blocked: boolean }

export const UNSENT_START: Unsent = { live: false, edits: 0, confirmed: 0 }

/**
 * 사건 하나를 받은 뒤의 상태. 다시 맞추면(live가 참이 되면) 남은 변경은 서버에 닿은 것이다(다시 맞출 때 y sync가
 * 빠진 갱신을 보낸다). 맞춰진 동안의 갱신은 `confirmed`가 와야 빠진다.
 */
export function unsentAfter(state: Unsent, event: UnsentEvent): Unsent {
  switch (event.type) {
    case 'live':
      return event.live ? { live: true, edits: state.edits, confirmed: state.edits } : { ...state, live: false }
    case 'local':
      return { ...state, edits: state.edits + 1 }
    case 'remote':
      return state
    case 'confirmed':
      return { ...state, confirmed: Math.max(state.confirmed, Math.min(event.upTo, state.edits)) }
  }
}

/** 탭을 떠나려 할 때 확인을 받을지 */
export function warnOnLeave(state: Unsent, screen: UnsentScreen): boolean {
  return state.edits > state.confirmed && !screen.switching && !screen.readOnly && !screen.blocked
}

/**
 * 맞춰진 동안 그린 뒤 이만큼 지나면 서버에 확인을 묻는다(서버가 모은 편집을 저장하는 주기 hub.FLUSH_EVERY와 같다).
 * 서버는 확인을 받아도 저장을 앞당기지 않고, 예정된 주기 저장(또는 진행 중 저장)이 끝나기를 기다려 답한다(#260).
 */
export const CHECK_AFTER_MS = 300

/** y-websocket의 messageSync(시험이 y-websocket을 갈아 끼워도 같은 값을 쓰게 옮겨 둔다) */
const MESSAGE_SYNC = 0

/** 서버가 지금까지 받은 것을 확인하는 메시지: sync step1(서버는 그때까지 받은 편집이 DB에 커밋된 뒤에 step2로 답한다) */
export function checkMessage(doc: Y.Doc): Uint8Array<ArrayBuffer> {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return new Uint8Array(encoding.toUint8Array(encoder))
}

/** 서버가 sync step2를 보낼 때마다 부른다(받은 것 확인의 답). 돌려준 함수로 그만 듣는다. */
export function listenForAnswers(provider: WebsocketProvider, onAnswer: () => void): () => void {
  const handle = provider.messageHandlers[MESSAGE_SYNC]
  provider.messageHandlers[MESSAGE_SYNC] = (encoder, decoder, p, emitSynced, messageType) => {
    const kind = decoding.peekVarUint(decoder)
    handle?.(encoder, decoder, p, emitSynced, messageType)
    if (kind === syncProtocol.messageYjsSyncStep2) onAnswer()
  }
  return () => void (provider.messageHandlers[MESSAGE_SYNC] = handle)
}

/**
 * 서버에 닿지 않은 내 변경이 있는지. 남이 보낸 갱신(origin이 provider)은 세지 않고, 커서(awareness)는 문서를 바꾸지
 * 않으니 처음부터 들어오지 않는다. 장(문서)이 바뀌면 새로 센다.
 *
 * 확인 근거(#258, #260): 맞춰진 동안 그리면 잠시 뒤 같은 연결로 sync step1을 보낸다. 서버는 한 연결의 메시지를 받은
 * 차례대로 처리하고, 그때까지 받은 편집이 커밋된 뒤에 받은 차례대로 답(step2)을 보내므로, 답이 오면 step1보다 먼저
 * 보낸 내 갱신은 모두 저장됐다.
 */
export function useUnsentChanges(doc: Y.Doc, provider: WebsocketProvider | null, live: boolean, screen: UnsentScreen): boolean {
  const [state, dispatch] = useReducer(
    (s: { doc: Y.Doc; unsent: Unsent }, e: UnsentEvent | { type: 'doc'; doc: Y.Doc }) =>
      e.type === 'doc' ? { doc: e.doc, unsent: UNSENT_START } : { ...s, unsent: unsentAfter(s.unsent, e) },
    { doc, unsent: UNSENT_START },
  )
  const providerRef = useRef(provider)
  const liveRef = useRef(live)
  /** 이 장에서 낸 내 갱신 수(reducer의 edits와 같은 수) */
  const edits = useRef(0)
  /** 답을 기다리는 확인마다 보낼 때까지의 내 갱신 수, 보낸 차례대로 */
  const waiting = useRef<number[]>([])
  const checkTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    providerRef.current = provider
    liveRef.current = live
  }, [provider, live])

  useEffect(() => {
    if (!provider) return
    // 연결이 바뀌면 옛 연결로 보낸 확인의 답은 오지 않는다
    const forget = () => void (waiting.current = [])
    const stop = listenForAnswers(provider, () => {
      const upTo = waiting.current.shift()
      if (upTo !== undefined) dispatch({ type: 'confirmed', upTo })
    })
    provider.on('status', forget)
    return () => {
      stop()
      provider.off('status', forget)
      forget()
    }
  }, [provider])

  useEffect(() => {
    dispatch({ type: 'doc', doc })
    edits.current = 0
    waiting.current = []
    const check = () => {
      checkTimer.current = undefined
      const p = providerRef.current
      if (!liveRef.current || !p?.wsconnected || !p.ws) return
      p.ws.send(checkMessage(doc))
      waiting.current.push(edits.current)
    }
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== null && origin === providerRef.current) return dispatch({ type: 'remote' })
      edits.current += 1
      dispatch({ type: 'local' })
      if (liveRef.current && checkTimer.current === undefined) checkTimer.current = window.setTimeout(check, CHECK_AFTER_MS)
    }
    doc.on('update', onUpdate)
    return () => {
      doc.off('update', onUpdate)
      window.clearTimeout(checkTimer.current)
      checkTimer.current = undefined
    }
  }, [doc])
  // 문서를 바꾼 effect 뒤에 돌아야 새 문서의 첫 상태를 지금 연결 상태로 잇는다
  useEffect(() => dispatch({ type: 'live', live }), [live, doc])

  return state.doc === doc && warnOnLeave(state.unsent, screen)
}

/** 참인 동안만 브라우저의 「떠나시겠어요?」 확인을 건다. 거짓이면 리스너가 없다. */
export function useLeaveWarning(on: boolean) {
  useEffect(() => {
    if (!on) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 옛 브라우저(Chrome 119 아래 등)는 returnValue가 있어야 확인을 띄운다
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [on])
}

/**
 * 누른 링크가 이 앱 안의 다른 화면으로 가는 평범한 이동이면 그 경로(#252). 새 탭·내려받기·다른 사이트·
 * 수정 키를 누른 클릭은 노트를 떠나지 않으므로 null.
 */
export function inAppLeaveTarget(e: MouseEvent, here: Location): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null
  if (!(a instanceof HTMLAnchorElement)) return null
  if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return null
  const url = new URL(a.getAttribute('href')!, here.href)
  if (url.origin !== here.origin) return null
  if (url.pathname === here.pathname && url.search === here.search) return null
  return url.pathname + url.search + url.hash
}

/**
 * 참인 동안 앱 안 링크로 노트를 떠나려 하면 멈추고 묻는다(#252). 앱이 스스로 하는 이동(navigate)은 막지 않는다.
 * BrowserRouter라 useBlocker를 쓸 수 없어, 링크 누르기를 먼저 받아 기본 동작을 막는다(Link는 막힌 누르기를 따르지 않는다).
 */
export function useInAppLeaveGuard(on: boolean) {
  const navigate = useNavigate()
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    if (!on) return
    const onClick = (e: MouseEvent) => {
      const to = inAppLeaveTarget(e, window.location)
      if (to === null) return
      e.preventDefault()
      setTarget(to)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [on])
  const stay = useCallback(() => setTarget(null), [])
  const leave = useCallback(() => {
    if (target === null) return
    setTarget(null)
    navigate(target)
  }, [navigate, target])
  return { target, stay, leave }
}
