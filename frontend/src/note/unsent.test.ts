import { act, renderHook } from '@testing-library/react'
import type { WebsocketProvider } from 'y-websocket'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { addStroke } from '../page/doc'
import { UNSENT_START, unsentAfter, useLeaveWarning, useUnsentChanges, warnOnLeave, type Unsent, type UnsentEvent } from './unsent'

// #250 끊긴 채 쓴 것이 있으면 탭을 떠나기 전에 묻는다. 서버에 닿으면(다시 맞추면) 묻지 않는다.

const LIVE: UnsentEvent = { type: 'live', live: true }
const DOWN: UnsentEvent = { type: 'live', live: false }
const LOCAL: UnsentEvent = { type: 'local' }
const REMOTE: UnsentEvent = { type: 'remote' }
const NOTE = { switching: false, readOnly: false, blocked: false }

const run = (events: UnsentEvent[]): Unsent => events.reduce(unsentAfter, UNSENT_START)

test.each<[string, UnsentEvent[], boolean]>([
  ['온라인에서 그리기', [LIVE, LOCAL], false],
  ['오프라인에서 그리기', [LIVE, DOWN, LOCAL], true],
  ['처음 붙기 전에 그리기', [LOCAL], true],
  ['오프라인에서 그리고 다시 연결·맞춤', [LIVE, DOWN, LOCAL, LIVE], false],
  ['다시 맞춘 뒤 온라인에서 더 그리기', [LIVE, DOWN, LOCAL, LIVE, LOCAL], false],
  ['다시 맞춘 뒤 또 끊기면 남은 것이 없다', [LIVE, DOWN, LOCAL, LIVE, DOWN], false],
  ['오프라인에서 그리고 끊김이 거듭돼도 남는다', [LIVE, DOWN, LOCAL, DOWN], true],
  ['오프라인에서 남의 갱신만', [LIVE, DOWN, REMOTE], false],
  ['오프라인에서 그린 뒤 남의 갱신이 와도 남는다', [LIVE, DOWN, LOCAL, REMOTE], true],
])('상태표: %s → 경고 %s', (_, events, warn) => {
  expect(warnOnLeave(run(events), NOTE)).toBe(warn)
})

test.each<[string, Partial<typeof NOTE>]>([
  ['장 교체 중', { switching: true }],
  ['읽기 전용', { readOnly: true }],
  ['막힘 화면', { blocked: true }],
])('남은 변경이 있어도 %s이면 경고하지 않는다', (_, screen) => {
  expect(warnOnLeave(run([LIVE, DOWN, LOCAL]), { ...NOTE, ...screen })).toBe(false)
})

const docs: Y.Doc[] = []
afterEach(() => docs.splice(0).forEach((d) => d.destroy()))

function setup() {
  const doc = new Y.Doc()
  docs.push(doc)
  const provider = { awareness: new Awareness(doc) } as unknown as WebsocketProvider
  const hook = renderHook(
    ({ doc, live }: { doc: Y.Doc; live: boolean }) => {
      const unsent = useUnsentChanges(doc, provider, live, NOTE)
      useLeaveWarning(unsent)
      return unsent
    },
    { initialProps: { doc, live: true } },
  )
  return { doc, provider, hook }
}

const draw = (doc: Y.Doc) =>
  act(() => addStroke(doc, { id: crypto.randomUUID(), tool: 'pen', color: '#000000', width: 2, points: [0, 0, 0.5], author: '나', createdAt: 0 }))
/** 브라우저가 떠나기 전에 보내는 사건. 확인을 띄우려면 기본 동작을 막는다 */
const leaving = () => {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

test('온라인에서 그리면 떠날 때 묻지 않는다', () => {
  const { doc, hook } = setup()
  draw(doc)
  expect(hook.result.current).toBe(false)
  expect(leaving()).toBe(false)
})

test('오프라인에서 그리면 묻고, 다시 연결해 맞추면 묻지 않는다', () => {
  const { doc, hook } = setup()
  hook.rerender({ doc, live: false })
  draw(doc)
  expect(hook.result.current).toBe(true)
  expect(leaving()).toBe(true)
  hook.rerender({ doc, live: true })
  expect(hook.result.current).toBe(false)
  expect(leaving()).toBe(false)
})

test('오프라인에서 남의 갱신·커서만 오면 묻지 않는다', () => {
  const { doc, provider, hook } = setup()
  hook.rerender({ doc, live: false })
  const other = new Y.Doc()
  docs.push(other)
  addStroke(other, { id: 's9', tool: 'pen', color: '#000000', width: 2, points: [0, 0, 0.5], author: '남', createdAt: 0 })
  act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), provider))
  const theirs = new Awareness(other)
  theirs.setLocalState({ nickname: '남', cursor: { x: 1, y: 2 } })
  act(() => applyAwarenessUpdate(provider.awareness, encodeAwarenessUpdate(theirs, [other.clientID]), provider))
  theirs.destroy()
  expect(hook.result.current).toBe(false)
  expect(leaving()).toBe(false)
})

test('장(문서)이 바뀌면 옛 장의 남은 변경은 세지 않는다', () => {
  const { doc, hook } = setup()
  hook.rerender({ doc, live: false })
  draw(doc)
  const next = new Y.Doc()
  docs.push(next)
  hook.rerender({ doc: next, live: false })
  expect(hook.result.current).toBe(false)
  draw(next)
  expect(hook.result.current).toBe(true)
})
