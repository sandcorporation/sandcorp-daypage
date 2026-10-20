"""노트 종이: 모양(줄 노트·모눈·점·무지), 왼쪽 여백 선, 종이 색. 노트 전체 설정이고 참여자 누구나 바꾼다.
저장된 값에 빠진 항목이나 모르는 값이 있으면 기본값(지금까지의 줄 노트)으로 채운다."""

PATTERNS = ("lined", "grid", "dot", "blank")
COLORS = ("white", "cream", "gray", "chalk")
DEFAULT = {"pattern": "lined", "margin": True, "color": "white"}


def normalize(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "pattern": raw.get("pattern") if raw.get("pattern") in PATTERNS else DEFAULT["pattern"],
        "margin": raw["margin"] if isinstance(raw.get("margin"), bool) else DEFAULT["margin"],
        "color": raw.get("color") if raw.get("color") in COLORS else DEFAULT["color"],
    }
