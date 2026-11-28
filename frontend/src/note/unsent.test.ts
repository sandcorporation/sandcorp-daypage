import { act, renderHook } from '@testing-library/react'
import type { WebsocketProvider } from 'y-websocket'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { addStroke } from '../page/doc'
import { FakeProvider } from '../test/fakeProvider'
import { CHECK_AFTER_MS, inAppLeaveTarget, UNSENT_START, unsentAfter, useLeaveWarning, useUnsentChanges, warnOnLeave, type Unsent, type UnsentEvent } from './unsent'

// #250 끊긴 채 쓴 것이 있으면 탭을 떠나기 전에 묻는다. 서버에 닿으면(다시 맞추면) 묻지 않는다.
// #258 맞춰진 동안 그린 것도 서버가 받았다고 확인될 때까지는 남은 것이다(소켓이 말없이 죽었을 수 있다).

const LIVE: UnsentEvent = { type: 'live', live: true }
const DOWN: UnsentEvent = { type: 'live', live: false }
const LOCAL: UnsentEvent = { type: 'local' }
const REMOTE: UnsentEvent = { type: 'remote' }
const ack = (upTo: number): UnsentEvent => ({ type: 'confirmed', upTo })
const NOTE = { switching: false, readOnly: false, blocked: false }

const run = (events: UnsentEvent[]): Unsent => events.reduce(unsentAfter, UNSENT_START)

const TABLE: [string, UnsentEvent[], boolean][] = [
  ['온라인에서 그리고 서버가 받음', [LIVE, LOCAL, ack(1)], false],
  ['온라인에서 그리고 아직 확인 전', [LIVE, LOCAL], true],
  ['온라인에서 그리고 확인 없이 끊김(말없이 죽은 소켓)', [LIVE, LOCAL, DOWN], true],
  ['온라인에서 그리고 서버가 받은 뒤 끊김', [LIVE, LOCAL, ack(1), DOWN], false],
  ['확인을 보낸 뒤 더 그린 것은 남는다', [LIVE, LOCAL, LOCAL, ack(1), DOWN], true],
  ['늦게 온 옛 확인은 앞선 확인을 되돌리지 않는다', [LIVE, LOCAL, LOCAL, ack(2), ack(1)], false],
  ['온라인에서 그리고 확인 없이 끊겼다 다시 맞춤', [LIVE, LOCAL, DOWN, LIVE], false],
  ['오프라인에서 그리기', [LIVE, DOWN, LOCAL], true],
  ['처음 붙기 전에 그리기', [LOCAL], true],
  ['오프라인에서 그리고 다시 연결·맞춤', [LIVE, DOWN, LOCAL, LIVE], false],
  ['다시 맞춘 뒤 온라인에서 더 그리고 서버가 받음', [LIVE, DOWN, LOCAL, LIVE, LOCAL, ack(2)], false],
  ['다시 맞춘 뒤 또 끊기면 남은 것이 없다', [LIVE, DOWN, LOCAL, LIVE, DOWN], false],
  ['오프라인에서 그리고 끊김이 거듭돼도 남는다', [LIVE, DOWN, LOCAL, DOWN], true],
  ['오프라인에서 남의 갱신만', [LIVE, DOWN, REMOTE], false],
  ['온라인에서 남의 갱신만 받고 끊김', [LIVE, REMOTE, DOWN], false],
  ['오프라인에서 그린 뒤 남의 갱신이 와도 남는다', [LIVE, DOWN, LOCAL, REMOTE], true],
]
test.each(TABLE.map(([name, events, warn]) => [name, warn, events] as const))('상태표: %s → 경고 %s', (_, warn, events) => {
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
afterEach(() => {
  docs.splice(0).forEach((d) => d.destroy())
  vi.useRealTimers()
})

function setup() {
  vi.useFakeTimers()
  const doc = new Y.Doc()
  docs.push(doc)
  const fake = new FakeProvider('', '', doc)
  const provider = fake as unknown as WebsocketProvider
  const hook = renderHook(
    ({ doc, live }: { doc: Y.Doc; live: boolean }) => {
      const unsent = useUnsentChanges(doc, provider, live, NOTE)
      useLeaveWarning(unsent)
      return unsent
    },
    { initialProps: { doc, live: true } },
  )
  return { doc, fake, provider, hook }
}

const draw = (doc: Y.Doc) =>
  act(() => addStroke(doc, { id: crypto.randomUUID(), tool: 'pen', color: '#000000', width: 2, points: [0, 0, 0.5], author: '나', createdAt: 0 }))
/** 확인을 보낼 때까지 기다린다 */
const checkSent = () => act(() => void vi.advanceTimersByTime(CHECK_AFTER_MS))
/** 브라우저가 떠나기 전에 보내는 사건. 확인을 띄우려면 기본 동작을 막는다 */
const leaving = () => {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

test('온라인에서 그리면 서버가 받았다고 답할 때까지만 묻는다', () => {
  const { doc, fake, hook } = setup()
  draw(doc)
  expect(hook.result.current).toBe(true)
  checkSent()
  expect(fake.sent).toHaveLength(1)
  act(() => fake.answerChecks())
  expect(hook.result.current).toBe(false)
  expect(leaving()).toBe(false)
})

test('온라인에서 그린 뒤 답 없이 끊기면 묻는다', () => {
  const { doc, hook } = setup()
  draw(doc)
  checkSent()
  hook.rerender({ doc, live: false })
  expect(hook.result.current).toBe(true)
  expect(leaving()).toBe(true)
})

test('끊긴 연결로 보낸 확인의 답은 새 연결의 답으로 치지 않는다', () => {
  const { doc, fake, hook } = setup()
  draw(doc)
  checkSent()
  act(() => fake.emit('status', [{ status: 'disconnected' }]))
  act(() => fake.answerChecks())
  expect(hook.result.current).toBe(true)
})

test('맞춰지지 않은 동안에는 확인을 보내지 않는다', () => {
  const { doc, fake, hook } = setup()
  hook.rerender({ doc, live: false })
  draw(doc)
  checkSent()
  expect(fake.sent).toHaveLength(0)
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

test('남의 갱신·커서만 오면 온라인이든 오프라인이든 묻지 않는다', () => {
  const { doc, provider, hook } = setup()
  act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(new Y.Doc()), provider))
  expect(hook.result.current).toBe(false)
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

describe('inAppLeaveTarget', () => {
  const here = new URL('http://localhost/note/n1') as unknown as Location
  const click = (attrs: Record<string, string>, init: MouseEventInit = {}) => {
    const a = document.createElement('a')
    Object.entries(attrs).forEach(([k, v]) => a.setAttribute(k, v))
    const span = document.createElement('span')
    a.append(span)
    document.body.append(a)
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    Object.defineProperty(e, 'target', { value: span })
    a.remove()
    return inAppLeaveTarget(e, here)
  }
  test.each<[string, Record<string, string>, MouseEventInit, string | null]>([
    ['앱 안 다른 화면', { href: '/note/n1/history' }, {}, '/note/n1/history'],
    ['홈', { href: '/' }, {}, '/'],
    ['같은 화면', { href: '/note/n1#x' }, {}, null],
    ['다른 사이트', { href: 'https://example.com/' }, {}, null],
    ['새 탭', { href: '/x', target: '_blank' }, {}, null],
    ['내려받기', { href: '/x', download: '' }, {}, null],
    ['수정 키', { href: '/x' }, { metaKey: true }, null],
    ['가운데 단추', { href: '/x' }, { button: 1 }, null],
  ])('%s', (_, attrs, init, want) => {
    expect(click(attrs, init)).toBe(want)
  })
})
