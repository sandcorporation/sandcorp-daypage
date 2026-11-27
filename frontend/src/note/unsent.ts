import { useEffect, useReducer, useRef } from 'react'
import type { WebsocketProvider } from 'y-websocket'
import type * as Y from 'yjs'

/**
 * 서버에 닿지 않은 내 변경(#250). y-websocket은 받았다는 답을 주지 않으므로, 연결이 맞춰진 동안(live) 낸 갱신은
 * 곧바로 보내졌다고 보고, 맞춰지지 않은 동안 낸 갱신은 다음에 서버와 다시 맞출 때까지 남았다고 본다.
 */
export type Unsent = { live: boolean; pending: boolean }

export type UnsentEvent =
  /** 연결이 맞춰졌는지(연결됨 + 서버와 sync)가 바뀌었다 */
  | { type: 'live'; live: boolean }
  /** 내가 문서를 고쳤다 */
  | { type: 'local' }
  /** 서버가 보낸 남의 갱신 */
  | { type: 'remote' }

/** 화면이 지금 문서를 쓰는 노트인지. 장 교체·읽기 전용·막힘(오류·대기열) 화면에서는 경고하지 않는다. */
export type UnsentScreen = { switching: boolean; readOnly: boolean; blocked: boolean }

export const UNSENT_START: Unsent = { live: false, pending: false }

/** 사건 하나를 받은 뒤의 상태. 다시 맞추면(live가 참이 되면) 남은 변경은 서버에 닿은 것이다. */
export function unsentAfter(state: Unsent, event: UnsentEvent): Unsent {
  switch (event.type) {
    case 'live':
      return event.live ? { live: true, pending: false } : { ...state, live: false }
    case 'local':
      return state.live || state.pending ? state : { ...state, pending: true }
    case 'remote':
      return state
  }
}

/** 탭을 떠나려 할 때 확인을 받을지 */
export function warnOnLeave(state: Unsent, screen: UnsentScreen): boolean {
  return state.pending && !screen.switching && !screen.readOnly && !screen.blocked
}

/**
 * 서버에 닿지 않은 내 변경이 있는지. 남이 보낸 갱신(origin이 provider)은 세지 않고, 커서(awareness)는 문서를 바꾸지
 * 않으니 처음부터 들어오지 않는다. 장(문서)이 바뀌면 새로 센다.
 */
export function useUnsentChanges(doc: Y.Doc, provider: WebsocketProvider | null, live: boolean, screen: UnsentScreen): boolean {
  const [state, dispatch] = useReducer(
    (s: { doc: Y.Doc; unsent: Unsent }, e: UnsentEvent | { type: 'doc'; doc: Y.Doc }) =>
      e.type === 'doc' ? { doc: e.doc, unsent: UNSENT_START } : { ...s, unsent: unsentAfter(s.unsent, e) },
    { doc, unsent: UNSENT_START },
  )
  const providerRef = useRef(provider)
  useEffect(() => {
    providerRef.current = provider
  }, [provider])

  useEffect(() => {
    dispatch({ type: 'doc', doc })
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      dispatch({ type: origin !== null && origin === providerRef.current ? 'remote' : 'local' })
    }
    doc.on('update', onUpdate)
    return () => doc.off('update', onUpdate)
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
