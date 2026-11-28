import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { ObservableV2 } from 'lib0/observable'
import { Awareness } from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'

type Handler = (encoder: encoding.Encoder, decoder: decoding.Decoder) => void

/** 서버 대신 메시지·닫는 코드를 흉내 내는 provider */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class FakeProvider extends ObservableV2<Record<string, (...args: any[]) => void>> {
  static instances: FakeProvider[] = []
  messageHandlers: Record<number, Handler> = {}
  shouldConnect = true
  awareness: Awareness
  doc: Y.Doc
  wsconnected = true
  /** y-websocket처럼: 서버와 맞췄는지, 마지막으로 무엇을 받은 시각(ms) */
  synced = false
  wsLastMessageReceived = 0
  /** 서버로 보낸 메시지 */
  sent: Uint8Array[] = []
  ws = { send: (message: Uint8Array) => void this.sent.push(message) }
  /** destroy로 연결을 닫았다(닫힌 연결로는 아무것도 받지 못한다) */
  destroyed = false
  constructor(_url: string, _room: string, doc: Y.Doc) {
    super()
    this.doc = doc
    this.awareness = new Awareness(doc)
    FakeProvider.instances.push(this)
  }
  /** Daypage 전용 메시지(종류 + JSON 문자열)를 받은 것처럼 */
  receive(kind: number, payload: object) {
    if (this.destroyed) return
    const enc = encoding.createEncoder()
    encoding.writeVarString(enc, JSON.stringify(payload))
    this.messageHandlers[kind](encoding.createEncoder(), decoding.createDecoder(encoding.toUint8Array(enc)))
  }
  /** 보낸 sync step1(받은 것 확인)마다 서버처럼 step2로 답한다 */
  answerChecks() {
    const checks = this.sent.filter((m) => m[0] === 0 && m[1] === syncProtocol.messageYjsSyncStep1)
    this.sent = []
    for (const _ of checks) {
      const enc = encoding.createEncoder()
      syncProtocol.writeSyncStep2(enc, this.doc)
      this.messageHandlers[0](encoding.createEncoder(), decoding.createDecoder(encoding.toUint8Array(enc)))
    }
  }
  destroy() {
    this.destroyed = true
    this.awareness.destroy()
    super.destroy()
  }
}
