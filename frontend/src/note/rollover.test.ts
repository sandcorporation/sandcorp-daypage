import { describe, expect, test } from 'vitest'
import { rollAfter, type RollEvent, type RollPhase, type RollStep } from './rollover'

const ROLLED: RollEvent = { type: 'rolled' }
const SWITCHED: RollEvent = { type: 'switched' }
const EDIT: RollEvent = { type: 'edit' }
const LOST2: RollEvent = { type: 'lost', count: 2 }
const CLOSED: RollEvent = { type: 'closed' }

const step = (phase: RollPhase, lost = 0, destroy = false): RollStep => ({ phase, lost, destroy })

// 전이표(#278): [지금, 사건] → [다음, 알릴 버린 수, provider 없앰]
const TABLE: [RollPhase, RollEvent, RollStep][] = [
  ['live', EDIT, step('live')],
  ['live', LOST2, step('live', 2)],
  ['live', ROLLED, step('rolled')],
  ['live', CLOSED, step('live')], // 평소 끊김: y-websocket이 다시 붙는다
  ['live', SWITCHED, step('done', 0, true)],
  // 100 받은 뒤 화면이 바뀌기 전: 옛 문서 편집은 열린 연결로 간다, 106은 알린다
  ['rolled', EDIT, step('rolled')],
  ['rolled', LOST2, step('rolled', 2)],
  ['rolled', ROLLED, step('rolled')],
  ['rolled', SWITCHED, step('draining')], // 화면은 새 장, 옛 연결은 닫지 않는다
  ['rolled', CLOSED, step('closed')],
  // 화면이 바뀐 뒤 옛 연결: 늦게 놓은 옮기기도 보내고, 100 전에 보낸 편집의 106도 늦게 받아 알린다
  ['draining', EDIT, step('draining')],
  ['draining', LOST2, step('draining', 2)],
  ['draining', ROLLED, step('draining')],
  ['draining', SWITCHED, step('draining')],
  ['draining', CLOSED, step('closed', 0, true)],
  // 옛 연결이 닫힌 뒤 옛 문서 편집은 보낼 길이 없다: 한 사람에게 하나씩 알린다
  ['closed', EDIT, step('closed', 1)],
  ['closed', SWITCHED, step('closed', 0, true)],
  ['closed', CLOSED, step('closed')],
  // 교체 없이 놓은 연결(화면 떠남·다시 붙기): 같은 문서는 다음 provider가 보낸다
  ['done', EDIT, step('done')],
  ['done', LOST2, step('done')],
  ['done', SWITCHED, step('done')],
]

describe('장 교체 때 옛 장 연결의 전이표', () => {
  test.each(TABLE)('%s + %o → %o', (phase, event, expected) => {
    expect(rollAfter(phase, event)).toEqual(expected)
  })
})

/** 사건을 차례로 겪은 뒤 알린 버린 수의 합과 없앤 횟수 */
function run(events: RollEvent[]) {
  let phase: RollPhase = 'live'
  let lost = 0
  let destroyed = 0
  for (const e of events) {
    const s = rollAfter(phase, e)
    phase = s.phase
    lost += s.lost
    if (s.destroy) destroyed += 1
  }
  return { phase, lost, destroyed }
}

describe('경계를 넘는 흐름', () => {
  test('100 전에 보낸 편집의 106이 화면 교체 뒤에 와도 알린다', () => {
    expect(run([EDIT, ROLLED, SWITCHED, LOST2, CLOSED])).toEqual({ phase: 'closed', lost: 2, destroyed: 1 })
  })

  test('100 뒤 옛 문서에 놓은 옮기기는 열린 연결로 가고, 서버가 버리면 106으로 한 번만 센다', () => {
    expect(run([ROLLED, SWITCHED, EDIT, { type: 'lost', count: 1 }, CLOSED])).toEqual({
      phase: 'closed',
      lost: 1,
      destroyed: 1,
    })
  })

  test('옛 연결이 닫힌 뒤 놓은 옮기기는 클라이언트가 센다', () => {
    expect(run([ROLLED, SWITCHED, CLOSED, EDIT])).toEqual({ phase: 'closed', lost: 1, destroyed: 1 })
  })

  test('잃지 않은 사람은 알림을 받지 않는다', () => {
    expect(run([EDIT, ROLLED, SWITCHED, CLOSED])).toEqual({ phase: 'closed', lost: 0, destroyed: 1 })
  })

  test('다시 붙기로 놓은 연결은 편집을 잃은 것으로 세지 않는다', () => {
    expect(run([SWITCHED, EDIT, EDIT])).toEqual({ phase: 'done', lost: 0, destroyed: 1 })
  })
})
