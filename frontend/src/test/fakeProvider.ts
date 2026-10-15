import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { ObservableV2 } from 'lib0/observable'
import { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

type Handler = (encoder: encoding.Encoder, decoder: decoding.Decoder) => void

/** 서버 대신 메시지·닫는 코드를 흉내 내는 provider */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class FakeProvider extends ObservableV2<Record<string, (...args: any[]) => void>> {
  static instances: FakeProvider[] = []
  messageHandlers: Record<number, Handler> = {}
  shouldConnect = true
  awareness: Awareness
  constructor(_url: string, _room: string, doc: Y.Doc) {
    super()
    this.awareness = new Awareness(doc)
    FakeProvider.instances.push(this)
  }
  /** Daypage 전용 메시지(종류 + JSON 문자열)를 받은 것처럼 */
  receive(kind: number, payload: object) {
    const enc = encoding.createEncoder()
    encoding.writeVarString(enc, JSON.stringify(payload))
    this.messageHandlers[kind](encoding.createEncoder(), decoding.createDecoder(encoding.toUint8Array(enc)))
  }
  destroy() {
    this.awareness.destroy()
    super.destroy()
  }
}
