"""획 점 바이너리: 프론트 pointCodec.ts와 같은 바이트를 내야 한다(공유 시험 벡터)."""

import json
from pathlib import Path

import pytest

from daypage.points import decode_points, encode_points

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend/src/page/pointCodec.vectors.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_encoder_matches_frontend_bytes(case):
    assert encode_points(case["points"]).hex() == case["bytes"]


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_decoder_reads_frontend_bytes_at_stored_precision(case):
    """되살린 값은 좌표 0.1, 필압 0.01 단위 격자 위에 있고 원래 값에서 반 칸 안이다(필압은 0~2.55로 잘린다)."""
    points = case["points"]
    got = decode_points(bytes.fromhex(case["bytes"]))
    assert len(got) == len(points) - len(points) % 3
    for i in range(0, len(got), 3):
        x, y, p = points[i : i + 3]
        gx, gy, gp = got[i : i + 3]
        assert abs(gx - x) <= 0.05 + 1e-9 and abs(gy - y) <= 0.05 + 1e-9
        assert gx * 10 == round(gx * 10) and gy * 10 == round(gy * 10)
        assert abs(gp - min(2.55, max(0.0, p))) <= 0.005 + 1e-9


def test_unknown_format_reads_as_empty():
    assert decode_points(bytes([99, 1, 2, 3])) == []
    assert decode_points(b"") == []
