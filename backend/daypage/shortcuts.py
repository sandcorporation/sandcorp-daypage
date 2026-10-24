"""사용자가 바꾼 단축키(frontend/src/page/shortcuts.ts). 기본값과 다른 동작만 {동작: [키 조합]}으로 둔다.

키 조합의 모양·동작 이름은 프론트와 같다. 어느 기기에서든 같은 사람이면 같은 단축키를 쓰게 사용자에 둔다.
"""

import re

ACTIONS = frozenset(
    {
        "pen",
        "highlighter",
        "paint",
        "shape",
        "text",
        "eraser",
        "select",
        "eyedropper",
        "undo",
        "redo",
        "delete",
        "zoomIn",
        "zoomOut",
        "zoomFit",
        "focus",
        "help",
    }
)
COMBO = re.compile(r"^(Mod\+)?(Alt\+)?(Shift\+)?[A-Za-z0-9]{1,24}$")
# 정해진 쓰임이 있어 바꿀 수 없는 키(Esc·Space·Enter·Tab)
RESERVED = frozenset({"Escape", "Space", "Enter", "NumpadEnter", "Tab"})
MAX_PER_ACTION = 4


def validate(raw: object) -> dict[str, list[str]] | None:
    """올바르면 그대로(순서 유지), 아니면 None. 한 키 조합을 두 동작이 함께 쓰면 안 된다."""
    if not isinstance(raw, dict):
        return None
    seen: set[str] = set()
    out: dict[str, list[str]] = {}
    for action, combos in raw.items():
        if action not in ACTIONS or not isinstance(combos, list) or len(combos) > MAX_PER_ACTION:
            return None
        for c in combos:
            if not isinstance(c, str) or not COMBO.match(c) or c in RESERVED or c in seen:
                return None
            seen.add(c)
        out[action] = list(combos)
    return out
