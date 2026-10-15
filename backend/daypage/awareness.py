"""y-protocols awareness 메시지 풀기·만들기.

메시지: [1(AWARENESS), varUint 길이, 업데이트]
업데이트: varUint 개수, 그리고 항목마다 varUint clientID, varUint clock, varString 상태 JSON("null"이면 나감)
"""

import json

from pycrdt import Decoder, YMessageType, read_message, write_message, write_var_uint

Entry = tuple[int, int, dict | None]


def decode_update(update: bytes) -> list[Entry]:
    decoder = Decoder(update)
    count = decoder.read_var_uint()
    entries: list[Entry] = []
    for _ in range(count):
        client_id = decoder.read_var_uint()
        clock = decoder.read_var_uint()
        state = json.loads(decoder.read_var_string())
        entries.append((client_id, clock, state if isinstance(state, dict) else None))
    return entries


def encode_update(entries: list[Entry]) -> bytes:
    # pycrdt Encoder.write_var_string은 길이를 바이트가 아닌 글자 수로 써서 한글이 깨진다. 직접 쓴다.
    out = [write_var_uint(len(entries))]
    for client_id, clock, state in entries:
        text = json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        out += [write_var_uint(client_id), write_var_uint(clock), write_var_uint(len(text)), text]
    return b"".join(out)


def decode_message(message: bytes) -> list[Entry]:
    return decode_update(read_message(message[1:]))


def encode_message(entries: list[Entry]) -> bytes:
    return bytes([YMessageType.AWARENESS]) + write_message(encode_update(entries))
