"""획 점 바이너리. 프론트 frontend/src/page/pointCodec.ts와 바이트 단위로 같다.

[형식 번호 1] 다음 점마다 [dx·10 지그재그 varint][dy·10 지그재그 varint][필압·100 1바이트].
공유 시험 벡터: frontend/src/page/pointCodec.vectors.json.
"""

import math
from collections.abc import Sequence

from pycrdt import Doc, Map

POINT_FORMAT = 1


def _js_round(v: float) -> int:
    """JS Math.round: 가장 가까운 정수, .5는 +무한대 쪽(-0.5 → 0, 2.5 → 3). Python round는 짝수 쪽이라 다르다."""
    r = math.floor(v)
    return r + 1 if v - r >= 0.5 else r


def _write_varint(out: bytearray, n: int) -> None:
    z = n * 2 if n >= 0 else -n * 2 - 1  # 지그재그
    while z >= 0x80:
        out.append((z & 0x7F) | 0x80)
        z >>= 7
    out.append(z)


def encode_points(points: Sequence[float]) -> bytes:
    out = bytearray([POINT_FORMAT])
    px = py = 0
    for i in range(0, len(points) - 2, 3):
        # 곱한 뒤 반올림: JS와 같은 double 연산 순서
        x = _js_round(points[i] * 10)
        y = _js_round(points[i + 1] * 10)
        _write_varint(out, x - px)
        _write_varint(out, y - py)
        out.append(max(0, min(255, _js_round(points[i + 2] * 100))))
        px, py = x, y
    return bytes(out)


def decode_points(data: bytes) -> list[float]:
    if not data or data[0] != POINT_FORMAT:
        return []
    points: list[float] = []
    i = 1
    x = y = 0

    def read_varint() -> int:
        nonlocal i
        z = shift = 0
        while True:
            b = data[i]
            i += 1
            z |= (b & 0x7F) << shift
            if b < 0x80:
                break
            shift += 7
        return z // 2 if z % 2 == 0 else -(z + 1) // 2

    while i < len(data):
        x += read_varint()
        y += read_varint()
        points += [x / 10, y / 10, data[i] / 100]
        i += 1
    return points


def _numbers(value: object) -> list[float] | None:
    """옛 형식 점(숫자 배열)이면 그 목록, 아니면 None(모르는 모양은 건드리지 않는다)."""
    if not isinstance(value, list):
        return None
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in value):
        return None
    return value


def pack_points(doc: Doc) -> int:
    """옛 형식(points 숫자 배열) 획을 바이너리(pts)로 바꾼다. 바꾼 획 수를 돌려준다.

    이미 pts인 획은 건너뛰므로 두 번 돌려도 같다. 지운 points는 Yjs가 GC해 스냅샷에 남지 않는다.
    """
    strokes = doc.get("strokes", type=Map)
    targets: list[tuple[Map, list[float]]] = []
    for stroke in strokes.values():
        if not isinstance(stroke, Map) or "pts" in stroke or "points" not in stroke:
            continue
        points = _numbers(stroke["points"])
        if points is not None:
            targets.append((stroke, points))
    if targets:
        with doc.transaction():
            for stroke, points in targets:
                stroke["pts"] = encode_points(points)
                del stroke["points"]
    return len(targets)
