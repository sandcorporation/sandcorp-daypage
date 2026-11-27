import { renderHook } from '@testing-library/react'
import type { WebsocketProvider } from 'y-websocket'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { usePresence } from './usePresence'

// #240 다시 연결되면 provider(와 awareness)가 새로 만들어진다. 글 상자의 초점은 그대로라 focus는 다시 오지 않는다.

const me = { nickname: '졸린 수달', color: '#000' }
const docs: Y.Doc[] = []
afterEach(() => docs.splice(0).forEach((d) => d.destroy()))

function newProvider() {
  const doc = new Y.Doc()
  docs.push(doc)
  return { awareness: new Awareness(doc) } as unknown as WebsocketProvider
}

function connected() {
  return renderHook((provider: WebsocketProvider | null) => usePresence(provider, me), { initialProps: newProvider() as WebsocketProvider | null })
}

test('#240 상자를 고치는 중 provider가 바뀌면 새 상태에 고치는 상자와 커서가 담긴다', () => {
  const hook = connected()
  hook.result.current.setCursor({ x: 10.4, y: 20.6 })
  hook.result.current.setEditing('box-1')
  const next = newProvider()
  hook.rerender(next)
  expect(next.awareness.getLocalState()).toEqual({ ...me, cursor: { x: 10, y: 21 }, editingBoxId: 'box-1' })
})

test('#240 provider가 없는 사이에 바꾼 값이 다음 provider의 첫 상태가 된다', () => {
  const hook = connected()
  hook.result.current.setEditing('box-1')
  hook.rerender(null)
  hook.result.current.setEditing('box-2')
  hook.result.current.setCursor(null)
  const next = newProvider()
  hook.rerender(next)
  expect(next.awareness.getLocalState()).toEqual({ ...me, cursor: null, editingBoxId: 'box-2' })
})

test('#240 고치기를 마친 뒤 다시 연결되면 고치는 상자가 되살아나지 않는다', () => {
  const hook = connected()
  hook.result.current.setEditing('box-1')
  hook.result.current.setEditing(null)
  const next = newProvider()
  hook.rerender(next)
  expect(next.awareness.getLocalState()).toMatchObject({ editingBoxId: null })
})
