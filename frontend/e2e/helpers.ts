import { expect, type CDPSession, type Page } from '@playwright/test'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { decodePoints } from '../src/page/pointCodec'

export type Pt = { x: number; y: number }
export type SavedStroke = { id: string; tool: string; width: number; points: number[] }
export type SavedBox = { id: string; x: number; y: number }

/** 이 시험이 보낸 Yjs 갱신을 모아 둔 문서. 서버를 거치지 않고 브라우저가 보낸 것을 그대로 본다. */
export type Saved = {
  strokes(): SavedStroke[]
  boxes(): SavedBox[]
}

const MESSAGE_SYNC = 0

/** dev-login → 새 노트(API) → 노트 화면. 웹소켓으로 나가는 Yjs 갱신을 엿보아 저장된 획·글 상자를 읽게 한다. */
export async function openNote(page: Page): Promise<Saved> {
  const doc = new Y.Doc()
  page.on('websocket', (ws) => {
    ws.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return
      const decoder = decoding.createDecoder(new Uint8Array(payload))
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return
      syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc, 'e2e')
    })
  })
  // 로그인·노트 만들기는 화면을 거치지 않고 API로(시험 시간 한도)
  const api = page.context().request
  await api.get('/auth/dev-login?kakao_id=9001&next=/api/me')
  const csrf = (await page.context().cookies()).find((c) => c.name === 'csrftoken')?.value ?? ''
  const res = await api.post('/api/notes', { data: { name: 'e2e', memberLimit: 2 }, headers: { 'X-CSRFToken': csrf } })
  const { id } = (await res.json()) as { id: string }
  await page.goto(`/note/${id}`)
  await page.locator('.page-frame').waitFor()
  return {
    strokes: () =>
      [...doc.getMap<Y.Map<unknown>>('strokes').entries()].map(([sid, m]) => {
        const pts = m.get('pts')
        return {
          id: sid,
          tool: String(m.get('tool')),
          width: Number(m.get('width')),
          points: pts instanceof Uint8Array ? decodePoints(pts) : ((m.get('points') as number[] | undefined) ?? []),
        }
      }),
    boxes: () =>
      [...doc.getMap<Y.Map<unknown>>('textboxes').entries()].map(([bid, m]) => ({
        id: bid,
        x: Number(m.get('x')),
        y: Number(m.get('y')),
      })),
  }
}

/** 저장된 획이 n개가 될 때까지 기다린다(고정 대기 없이 사건을 폴링). */
export async function savedStrokes(_page: Page, saved: Saved, n: number): Promise<SavedStroke[]> {
  await expect.poll(() => saved.strokes().length, { timeout: 2_000, intervals: [20, 50, 100] }).toBe(n)
  return saved.strokes()
}

/** CDP로 펜(스타일러스)과 손가락을 흉내 낸다. 좌표는 CSS 픽셀. */
export class Hands {
  private cdp: CDPSession
  private constructor(cdp: CDPSession) {
    this.cdp = cdp
  }
  static async on(page: Page): Promise<Hands> {
    return new Hands(await page.context().newCDPSession(page))
  }

  private mouse(type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', p: Pt, force: number, down: boolean, pointerType: 'pen' | 'mouse' = 'pen') {
    return this.cdp.send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: down || type === 'mouseReleased' ? 'left' : 'none',
      buttons: down ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType,
      force,
    })
  }

  /** 펜으로 한 획. force는 점마다의 필압(0~1). */
  async penStroke(path: (Pt & { force?: number })[]) {
    const [first, ...rest] = path
    const last = path[path.length - 1]
    // CDP는 한 세션에서 보낸 순서대로 처리하므로 왕복을 기다리지 않고 한꺼번에 보낸다(시험 시간 한도)
    await Promise.all([
      this.mouse('mouseMoved', first, 0, false),
      this.mouse('mousePressed', first, first.force ?? 0.5, true),
      ...rest.map((p) => this.mouse('mouseMoved', p, p.force ?? 0.5, true)),
      this.mouse('mouseReleased', last, 0, false),
    ])
  }

  /** 마우스로 한 획(펜을 보이지 않으려고 쓴다: 펜을 쓰면 손가락은 스크롤만 한다). */
  async mouseStroke(path: Pt[]) {
    const [first, ...rest] = path
    const last = path[path.length - 1]
    await Promise.all([
      this.mouse('mouseMoved', first, 0, false, 'mouse'),
      this.mouse('mousePressed', first, 0.5, true, 'mouse'),
      ...rest.map((p) => this.mouse('mouseMoved', p, 0.5, true, 'mouse')),
      this.mouse('mouseReleased', last, 0, false, 'mouse'),
    ])
  }

  private touch(type: 'touchStart' | 'touchMove' | 'touchEnd', points: (Pt & { id: number })[]) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : points.map((p) => ({ x: p.x, y: p.y, id: p.id, force: 0.5 })),
    })
  }

  /** 한 손가락으로 from→to를 steps번에 나눠 끈다. */
  async fingerDrag(from: Pt, to: Pt, steps = 8) {
    await this.touch('touchStart', [{ ...from, id: 1 }])
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      await this.touch('touchMove', [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }])
    }
    await this.touch('touchEnd', [])
  }

  /** 손가락 하나로 톡 누른다. */
  async fingerTap(p: Pt) {
    await this.touch('touchStart', [{ ...p, id: 1 }])
    await this.touch('touchEnd', [])
  }

  /** 두 손가락을 나란히 d만큼 끈다(두 손가락 스크롤). 둘 사이 간격은 gap으로 그대로다. */
  async twoFingerDrag(from: Pt, d: Pt, gap = 120, steps = 10) {
    const two = (t: number) => [
      { x: from.x - gap / 2 + d.x * t, y: from.y + d.y * t, id: 1 },
      { x: from.x + gap / 2 + d.x * t, y: from.y + d.y * t, id: 2 },
    ]
    await this.touch('touchStart', two(0))
    for (let i = 1; i <= steps; i++) await this.touch('touchMove', two(i / steps))
    await this.touch('touchEnd', [])
  }

  /** 두 손가락을 가운데 c 주위로 벌린다(간격 from→to). */
  async pinch(c: Pt, from: number, to: number, steps = 8) {
    const two = (d: number) => [
      { x: c.x - d / 2, y: c.y, id: 1 },
      { x: c.x + d / 2, y: c.y, id: 2 },
    ]
    await this.touch('touchStart', two(from))
    for (let i = 1; i <= steps; i++) await this.touch('touchMove', two(from + ((to - from) * i) / steps))
    await this.touch('touchEnd', [])
  }
}

/** 다음 두 프레임까지 기다린다(렌더·rAF에 맡긴 일이 끝나게). 시간이 아니라 프레임 사건이다. */
export function nextFrames(page: Page) {
  return page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

/** 화면 맞춤 배율(장 폭에 대한 화면 폭). */
export function frameScale(page: Page) {
  return page.locator('.page-frame').evaluate((el) => el.getBoundingClientRect().width / 1600)
}

/** 화면 맞춤에서 확대 단추를 n번 눌러 종이가 스크롤되게 한다. */
export async function zoomIn(page: Page, times = 2) {
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: '확대', exact: true }).click()
}

export const scrollTopOf = (page: Page) => page.locator('.page-viewport').evaluate((el) => el.scrollTop)
export const zoomPercent = async (page: Page) =>
  Number.parseInt((await page.getByRole('button', { name: '화면에 맞추기' }).textContent()) ?? '0', 10)
