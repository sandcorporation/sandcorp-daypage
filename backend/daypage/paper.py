"""노트 종이: 모양(줄 노트·모눈·점·무지), 왼쪽 여백 선, 종이 색. 노트 전체 설정이고 참여자 누구나 바꾼다.
종이 색은 기본 색 이름(COLORS)이거나 직접 만든 색 코드(#rrggbb)다.
저장된 값에 빠진 항목이나 모르는 값(없앤 '칠판' 포함)이 있으면 기본값(지금까지의 줄 노트)으로 채운다."""

import re

PATTERNS = ("lined", "grid", "dot", "blank")
COLORS = ("white", "cream", "gray")
CUSTOM_COLOR = re.compile(r"^#[0-9a-f]{6}$")
# API가 받는 종이 색(대소문자 무관). 저장할 때는 소문자로 맞춘다.
COLOR_INPUT = r"^(white|cream|gray|#[0-9a-fA-F]{6})$"
DEFAULT = {"pattern": "lined", "margin": True, "color": "white"}


def _color(value) -> str:
    if value in COLORS:
        return value
    if isinstance(value, str) and CUSTOM_COLOR.match(value.lower()):
        return value.lower()
    return DEFAULT["color"]


def normalize(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "pattern": raw.get("pattern") if raw.get("pattern") in PATTERNS else DEFAULT["pattern"],
        "margin": raw["margin"] if isinstance(raw.get("margin"), bool) else DEFAULT["margin"],
        "color": _color(raw.get("color")),
    }
