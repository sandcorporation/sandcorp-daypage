"""샘플(데모)용 노트의 오늘 페이지를 손글씨 메모와 낙서로 채운다.

    python manage.py seed_sample <노트 ID> [--style sparse|dense] [--new 이름] [--force]

장은 자정이 지나면 기록으로 넘어가므로, 데모 직전에 그날 장을 채우는 용도로 쓴다.
접속해 있는 사람에게도 바로 보이도록 웹소켓 방에 업데이트를 보낸다.
"""

import math
import random
import secrets
import time

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.management.base import BaseCommand, CommandError
from pycrdt import Doc, Map, XmlElement, XmlFragment, XmlText

from daypage import clock, membership, pages
from daypage.consumers import page_group
from daypage.models import Note, NoteMember

INK_BLUE = "#2A47B0"
PENCIL = "#1F2128"
ORANGE = "#E0603A"
YELLOW = "#F2C230"
# 글자 색 마크(서식 막대의 색과 같음)
MARK_ORANGE = "#C2410C"

# 글꼴 id → 32px 줄에 맞춘 기본 크기(frontend/src/page/fonts.ts와 같음)
FONT_SIZE = {"pen": 28, "gaegu": 22, "gamja": 22, "himelody": 24, "gothic": 19, "myeongjo": 19}

ME = "me"  # 노트 주인의 닉네임으로 바뀐다
FRIEND = "졸린 수달"

BOLD = {"bold": {}}
BIG = {"textStyle": {"color": None, "fontSize": "1.15em"}}
STRIKE = {"strike": {}}


def orange(attrs: dict | None = None) -> dict:
    return {**(attrs or {}), "textStyle": {"color": MARK_ORANGE, "fontSize": None}}


# (x, y, 폭, 글꼴, 색, 쓴 사람, 문단들). 문단은 글자열 또는 (글자열, 서식) 조각의 리스트.
BOXES = [
    (110, 32, 560, "pen", INK_BLUE, ME, [[("오늘의 한 페이지 ✏️", {**BOLD, **BIG})]]),
    (110, 96, 820, "gothic", PENCIL, ME, ["링크를 받은 사람은 누구나 같은 페이지에 같이 쓰고 그릴 수 있어요"]),
    (
        120, 192, 430, "pen", PENCIL, ME,
        [[("오늘 할 일", BOLD)], "☑ 아침 산책 20분", "☑ 택배 찾아오기", "☐ 장 보기 (우유, 계란, 사과)", "☐ 저녁엔 영화 한 편!"],
    ),
    (720, 192, 420, "pen", ORANGE, FRIEND, ["이번 주말에 캠핑 갈래요? ⛺"]),
    (800, 256, 470, "pen", INK_BLUE, ME, ["좋아요!! 자라섬 어때요? 금요일 예약 된대요"]),
    (740, 320, 440, "pen", ORANGE, FRIEND, ["그럼 준비물은 제가 정리해 둘게요"]),
    (840, 384, 340, "pen", INK_BLUE, ME, ["고기는 제가 살게요 🍖"]),
    (760, 448, 200, "pen", ORANGE, FRIEND, ["최고 👍"]),
    (120, 448, 300, "pen", ORANGE, ME, [[("오늘 기분: ", None), ("맑음", BOLD)]]),
    (
        1120, 576, 420, "gamja", INK_BLUE, FRIEND,
        [[("캠핑 준비물 체크!", BOLD)], "- 텐트, 타프", "- 의자 두 개", "- 랜턴 + 보조배터리", "- 마시멜로 (제일 중요)"],
    ),
    (
        120, 576, 470, "himelody", PENCIL, ME,
        [
            [("이번 주 목표", BOLD)],
            "물 2L 마시기 💧",
            "책 30쪽씩 읽기",
            "일찍 자기 (진짜로)",
            [("야식 먹기", STRIKE), (" 참기!", None)],
        ],
    ),
    (130, 864, 440, "pen", PENCIL, ME, [[("저녁 메뉴 투표 🍲", BOLD)], "김치찌개 ✔✔", "파스타 ✔", "떡볶이"]),
    (640, 928, 470, "pen", INK_BLUE, FRIEND, ["김치찌개로 결정! 두부 많이 넣어 주세요"]),
    (
        900, 1024, 560, "gaegu", PENCIL, FRIEND,
        [
            [("김치찌개 황금 레시피", orange(BOLD))],
            "1. 김치랑 돼지고기 먼저 볶기",
            "2. 물 붓고 10분 끓이기",
            "3. 두부, 대파 넣고 5분 더",
            "4. 마지막에 참기름 한 방울",
        ],
    ),
    (
        130, 1120, 560, "myeongjo", PENCIL, ME,
        [
            [("오늘 고마웠던 일 세 가지", BOLD)],
            "하나. 출근길 버스를 아슬아슬하게 탔다",
            "둘. 동료가 커피를 사 줬다",
            "셋. 하늘이 엄청 맑았다",
        ],
    ),
    (1250, 1344, 300, "gamja", ORANGE, FRIEND, ["낙서 환영 ✍"]),
    (
        130, 1408, 560, "pen", INK_BLUE, ME,
        [[("다음에 같이 가고 싶은 곳 ★", BOLD)], "☆ 제주 오름 걷기", "☆ 망원동 빵집 투어", "☆ 가을 단풍 보러 설악산"],
    ),
    (780, 1472, 480, "pen", ORANGE, FRIEND, [[("설악산은 꼭!! ", BOLD), ("단풍 시즌 놓치지 말기", None)]]),
    (130, 1664, 470, "pen", INK_BLUE, ME, ["내일 아침 7시 알람 맞췄어요?"]),
    (230, 1728, 300, "pen", ORANGE, FRIEND, ["방금 맞췄어요 ⏰"]),
    (130, 1792, 400, "pen", INK_BLUE, ME, ["그럼 내일 페이지에서 봐요!"]),
    (840, 1824, 640, "himelody", INK_BLUE, ME, [[("작은 하루도 같이 쓰면 큰 이야기가 돼요", BIG)]]),
    (
        130, 2208, 900, "gothic", PENCIL, ME,
        ["밤 12시가 되면 이 페이지는 기록으로 넘어가고 새 페이지가 펼쳐져요.", "지난 페이지는 기록에서 언제든 다시 볼 수 있어요 👋"],
    ),
]


# ── 손그림 낙서 ────────────────────────────────────────────────

rng = random.Random(20261015)


def jitter(points: list[tuple[float, float]], amount: float = 1.2) -> list[float]:
    flat: list[float] = []
    for x, y in points:
        flat += [round(x + rng.uniform(-amount, amount), 1), round(y + rng.uniform(-amount, amount), 1), 0.5]
    return flat


def line(x1, y1, x2, y2, n=12):
    return [(x1 + (x2 - x1) * t / n, y1 + (y2 - y1) * t / n) for t in range(n + 1)]


def ellipse(cx, cy, rx, ry, start=0.0, sweep=2.15 * math.pi, n=48):
    # 손으로 그린 동그라미처럼 끝이 살짝 겹치게
    return [(cx + rx * math.cos(start + sweep * t / n), cy + ry * math.sin(start + sweep * t / n)) for t in range(n + 1)]


def wave(x1, x2, y, amp=5, period=26):
    n = max(8, int((x2 - x1) / 4))
    return [(x1 + (x2 - x1) * t / n, y + amp * math.sin((x1 + (x2 - x1) * t / n) / period * 2 * math.pi)) for t in range(n + 1)]


def heart(cx, cy, size):
    pts = []
    for t in range(0, 61):
        a = 2 * math.pi * t / 60
        x = 16 * math.sin(a) ** 3
        y = 13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)
        pts.append((cx + x * size / 16, cy - y * size / 16))
    return pts


def star(cx, cy, r):
    pts = []
    for i in range(11):
        rad = r if i % 2 == 0 else r * 0.45
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    return pts


def check(x, y, s=1.0):
    return [(x, y), (x + 8 * s, y + 10 * s), (x + 26 * s, y - 14 * s)]


def arrow_curve(x1, y1, x2, y2, bend=60):
    mx, my = (x1 + x2) / 2 + bend, (y1 + y2) / 2
    n = 24
    return [
        ((1 - t / n) ** 2 * x1 + 2 * (1 - t / n) * (t / n) * mx + (t / n) ** 2 * x2,
         (1 - t / n) ** 2 * y1 + 2 * (1 - t / n) * (t / n) * my + (t / n) ** 2 * y2)
        for t in range(n + 1)
    ]


def arrow_head(x, y, dx, dy, size=18):
    a = math.atan2(dy, dx)
    left = (x - size * math.cos(a - 0.5), y - size * math.sin(a - 0.5))
    right = (x - size * math.cos(a + 0.5), y - size * math.sin(a + 0.5))
    return [left, (x, y), right]


def sun(cx, cy, r):
    strokes = [("pen", YELLOW, 6, ellipse(cx, cy, r, r, sweep=2.05 * math.pi))]
    for i in range(8):
        a = i * math.pi / 4
        strokes.append(
            ("pen", YELLOW, 6, line(cx + (r + 8) * math.cos(a), cy + (r + 8) * math.sin(a),
                                    cx + (r + 22) * math.cos(a), cy + (r + 22) * math.sin(a), n=3))
        )
    return strokes


def tent(x, y):
    return [
        # 점이 적으면 펜 보정에 뭉개지므로 선분마다 점을 촘촘히 넣는다
        ("pen", PENCIL, 3, line(x, y + 80, x + 50, y, n=10) + line(x + 50, y, x + 100, y + 80, n=10)[1:]),
        ("pen", PENCIL, 3, line(x - 12, y + 80, x + 112, y + 80, n=10)),
        ("pen", ORANGE, 3, line(x + 42, y + 80, x + 50, y + 40, n=5) + line(x + 50, y + 40, x + 60, y + 80, n=5)[1:]),
    ]


def flower(cx, cy):
    strokes = [("pen", INK_BLUE, 3, line(cx, cy + 10, cx - 6, cy + 110, n=10))]
    for i in range(6):
        a = i * math.pi / 3
        strokes.append(("pen", ORANGE, 3, ellipse(cx + 16 * math.cos(a), cy + 16 * math.sin(a), 12, 12, sweep=2 * math.pi, n=20)))
    strokes.append(("pen", YELLOW, 6, ellipse(cx, cy, 6, 6, sweep=2 * math.pi, n=14)))
    strokes.append(("pen", INK_BLUE, 3, ellipse(cx - 18, cy + 70, 16, 7, sweep=2 * math.pi, n=20)))
    return strokes


def doodles() -> list[tuple[str, str, float, list[tuple[float, float]]]]:
    s: list[tuple[str, str, float, list[tuple[float, float]]]] = []
    # 형광펜: 제목·할 일·메뉴·가고 싶은 곳
    s.append(("highlighter", YELLOW, 24, line(116, 66, 330, 64)))
    s.append(("highlighter", YELLOW, 24, line(124, 210, 236, 210)))
    s.append(("highlighter", YELLOW, 24, line(134, 914, 300, 914)))
    s.append(("highlighter", YELLOW, 24, line(134, 1426, 470, 1426)))
    # 이번 주 목표 밑줄(물결)
    s.append(("pen", ORANGE, 3, wave(126, 300, 606)))
    # 오늘 기분 옆 해, 웃는 얼굴
    s += sun(400, 464, 18)
    s.append(("pen", PENCIL, 3, ellipse(470, 464, 18, 18, sweep=2.05 * math.pi, n=36)))
    s.append(("pen", PENCIL, 3, ellipse(463, 458, 1.5, 1.5, sweep=2 * math.pi, n=6)))
    s.append(("pen", PENCIL, 3, ellipse(477, 458, 1.5, 1.5, sweep=2 * math.pi, n=6)))
    s.append(("pen", PENCIL, 3, ellipse(470, 466, 9, 7, start=0.2, sweep=math.pi - 0.4, n=12)))
    # 캠핑 대화 옆 텐트, 준비물로 가는 화살표, 마시멜로 동그라미
    s += tent(1260, 210)
    s.append(("pen", ORANGE, 3, arrow_curve(990, 470, 1180, 590, bend=90)))
    s.append(("pen", ORANGE, 3, arrow_head(1180, 590, 0.6, 1)))
    s.append(("pen", ORANGE, 3, ellipse(1300, 720, 170, 24)))
    # 할 일 완료 체크
    s.append(("pen", ORANGE, 6, check(470, 236)))
    s.append(("pen", ORANGE, 6, check(470, 268)))
    # 메뉴 결정 동그라미
    s.append(("pen", INK_BLUE, 3, ellipse(205, 912, 80, 20)))
    # 고마운 일 옆 하트
    s.append(("pen", ORANGE, 6, heart(640, 1160, 22)))
    # 가고 싶은 곳 옆 별
    s.append(("pen", YELLOW, 6, star(720, 1440, 20)))
    s.append(("pen", YELLOW, 6, star(760, 1400, 12)))
    # 낙서 구역 꽃
    s += flower(1360, 1460)
    # 한 줄 문구 밑줄
    s.append(("pen", INK_BLUE, 3, wave(846, 1440, 1860, amp=3, period=40)))
    return s


# ── Yjs 문서 쓰기 ──────────────────────────────────────────────


def new_id() -> str:
    return secrets.token_hex(8)


def write_box(boxes: Map, spec, me: str) -> None:
    x, y, width, font, color, author, paragraphs = spec
    fragment = XmlFragment()
    boxes[new_id()] = Map(
        {
            "x": float(x),
            "y": float(y),
            "width": float(width),
            "color": color,
            "fontSize": float(FONT_SIZE[font]),
            "font": font,
            "author": me if author == ME else author,
            "content": fragment,
        }
    )
    for para in paragraphs:
        runs = [(para, None)] if isinstance(para, str) else para
        element = XmlElement("paragraph")
        fragment.children.append(element)
        text = XmlText()
        element.children.append(text)
        for chunk, attrs in runs:
            # pycrdt는 위치를 UTF-8 바이트로 센다. 현재 길이(len) 뒤에 붙여야 순서가 맞는다.
            if attrs:
                text.insert(len(text), chunk, attrs)
            else:
                text.insert(len(text), chunk)


def write_stroke(strokes: Map, tool, color, width, points, author: str, created_at: int) -> None:
    strokes[new_id()] = Map(
        {
            "tool": tool,
            "color": color,
            "width": float(width),
            "points": jitter(points, 0.8 if tool == "highlighter" else 1.2),
            "author": author,
            "createdAt": created_at,
        }
    )


# ── 빽빽한 버전: 장 전체를 짧은 대화 메모로 채운다 ───────────────────

PAGE_H, ROW = 2400, 32
LEFT, RIGHT = 84, 1580

# 글꼴별 실측 글자 폭(px). frontend의 글꼴·크기와 같다.
GLYPH = {
    "pen": {"ko": 16.3, "space": 7.8, "latin": 9.5},
    "gaegu": {"ko": 19.4, "space": 9.2, "latin": 10.2},
    "gamja": {"ko": 19.4, "space": 5.6, "latin": 8.9},
    "himelody": {"ko": 21.2, "space": 6.1, "latin": 8.4},
    "gothic": {"ko": 18.3, "space": 4.6, "latin": 9.8},
    "myeongjo": {"ko": 17.7, "space": 5.2, "latin": 9.3},
}

STYLE_ATTRS = {"bold": BOLD, "strike": STRIKE, "big": {**BOLD, **BIG}, "orange": orange(BOLD)}


def is_hangul(ch: str) -> bool:
    return 0xAC00 <= ord(ch) <= 0xD7A3 or 0x3131 <= ord(ch) <= 0x318E


def glyphs_width(text: str, font: str, factor: float = 1.0) -> float:
    g = GLYPH[font]
    w = 0.0
    for ch in text:
        if ch == " ":
            w += g["space"]
        elif 0x3131 <= ord(ch) <= 0x318E:  # ㅋ·ㅠ 같은 자모는 실제로 더 넓다
            w += g["ko"] * 1.35
        elif is_hangul(ch):
            w += g["ko"]
        elif ord(ch) < 0x2000:
            w += g["latin"]
        else:  # 이모지·기호는 글꼴 크기만큼
            w += FONT_SIZE[font]
    return w * factor


def box_width(paragraphs, font: str) -> int:
    """가장 긴 문단이 한 줄에 들어가는 폭. 굵게·손글씨 흔들림 여유 18%, 편집기 여백 12 + 테두리 4 + 10."""
    longest = 0.0
    for para in paragraphs:
        runs = [(para, None)] if isinstance(para, str) else para
        longest = max(longest, sum(glyphs_width(t, font, 1.15 if a == "big" else 1.0) for t, a in runs))
    return math.ceil(longest * 1.18 + 26)


def para_runs(para) -> list:
    if isinstance(para, str):
        return [(para, None)]
    return [(t, STYLE_ATTRS[a] if a else None) for t, a in para]


class Occupancy:
    """칸(32px)마다 가로로 차지한 구간. 글 상자·낙서가 겹치지 않게 자리를 찾는다."""

    def __init__(self):
        self.rows: dict[int, list[tuple[float, float]]] = {}

    def free(self, row: int, a: float, b: float) -> bool:
        return all(b <= x or a >= y for x, y in self.rows.get(row, []))

    def take(self, row: int, a: float, b: float) -> None:
        self.rows.setdefault(row, []).append((a, b))

    def segments(self, row: int) -> list[tuple[float, float]]:
        segs, cur = [], LEFT
        for a, b in sorted(self.rows.get(row, [])):
            if a > cur:
                segs.append((cur, a))
            cur = max(cur, b)
        if cur < RIGHT:
            segs.append((cur, RIGHT))
        return segs


COLUMNS = [80, 457, 834, 1211]  # '내 생각 해'처럼 장을 4칸으로 나눈다
COL_W = 360  # 글 상자 기본 폭


def lines_needed(paragraphs, font: str, width: int) -> int:
    """폭 안에서 문단들이 차지하는 줄 수(넘치면 접힌다)."""
    inner = width - 4 - 12  # 테두리·편집기 여백
    total = 0
    for para in paragraphs:
        runs = [(para, None)] if isinstance(para, str) else para
        # 손글씨 글꼴은 글자마다 폭이 들쭉날쭉해 여유를 넉넉히 둔다(접힘을 덜 세면 아래 메모와 겹친다)
        w = sum(glyphs_width(t, font, 1.15 if a == "big" else 1.0) for t, a in runs) * 1.3
        total += max(1, math.ceil(w / inner))
    return total


def dense_flow():
    """칸에 채울 순서: 제목 → 대화(이야기가 바뀌면 한 줄 띄움, 관련 목록을 끼움) → 안내."""
    from ._sample_dense import CHAT, LIST_BEFORE, LISTS, THREAD_STARTS

    before = {text: idx for idx, text in LIST_BEFORE.items()}
    flow = [("list", LISTS[0])]
    for who, text in CHAT:
        if text in THREAD_STARTS:
            flow.append(("gap",))
        if text in before:
            flow.append(("list", LISTS[before[text]]))
            flow.append(("gap",))
        flow.append(("chat", who, text))
    flow.append(("gap",))
    flow.append(("list", LISTS[-1]))
    return flow


def place_columns(flow, use_gap: bool):
    """흐름을 칸에 채운다. 다 들어가지 못하면 (None, 남은 개수)."""
    rows_total = PAGE_H // ROW
    out = []
    col, row = 0, 0
    for i, it in enumerate(flow):
        if it[0] == "gap":
            if use_gap and row > 0:
                row += 1
            continue
        if it[0] == "chat":
            n = lines_needed([it[2]], "pen", COL_W)
        else:
            n = lines_needed(it[1][5], it[1][3], COL_W)
        if row + n > rows_total:
            col, row = col + 1, 0
            if col >= len(COLUMNS):
                return None, sum(1 for rest in flow[i:] if rest[0] != "gap")
        out.append((it, col, row, n))
        row += n
    return out, 0


def dense_layout(me: str):
    """칸마다 다른 대화: 왼쪽 칸부터 위에서 아래로 채우고, 칸이 차면 다음 칸으로 넘어간다."""
    flow = dense_flow()
    # 넘치면 이야기 사이 빈 줄을 먼저 없애고, 그래도 넘치면 맨 끝 안내는 두고 대화 끝부터 덜어 낸다.
    for use_gap in (True, False):
        slots, _ = place_columns(flow, use_gap)
        if slots:
            break
    while not slots:
        last_chat = max(i for i, it in enumerate(flow) if it[0] == "chat")
        flow.pop(last_chat)
        slots, _ = place_columns(flow, False)

    specs, placed = [], []
    for it, col, row, n in slots:
        if it[0] == "chat":
            _, who, text = it
            font, paras = "pen", [[(text, None)]]
            if who == "A":
                color = INK_BLUE if rng.random() < 0.55 else PENCIL
            else:
                color = ORANGE if rng.random() < 0.75 else PENCIL
        else:
            _x, _y, _w, font, who, raw = it[1]
            paras = [para_runs(p) for p in raw]
            color = INK_BLUE if who == "A" else ORANGE
        # 손으로 붙인 듯 칸 안에서 살짝 들쭉날쭉하게(옆 칸을 넘지 않을 만큼)
        x = COLUMNS[col] + round(rng.uniform(0, 12))
        width = min(COL_W, 1600 - x)
        specs.append((x, row * ROW, width, font, color, ME if who == "A" else FRIEND, paras))
        placed.append((x, row * ROW, width, n))
    return specs, column_doodles(placed)


def column_doodles(placed):
    """메모 오른쪽 빈 자리·띄운 줄에 형광펜·밑줄·하트·별을 곁들인다."""
    s = []
    singles = [(x, y, w) for x, y, w, n in placed if n == 1]
    picks = rng.sample(singles, min(len(singles), 60))
    for x, y, w in picks[:16]:
        s.append(("highlighter", YELLOW, 22, line(x + 6, y + 20, x + 150, y + 19)))
    for x, y, w in picks[16:26]:
        s.append(("pen", rng.choice([ORANGE, INK_BLUE]), 3, wave(x + 6, x + 200, y + 30, amp=3, period=22)))
    for x, y, w in picks[26:32]:
        s.append(("pen", rng.choice([ORANGE, INK_BLUE, PENCIL]), 3, ellipse(x + 110, y + 16, 112, 19)))
    # 칸 안 메모의 오른쪽 끝(글이 짧아 비는 자리)에 작은 낙서
    for x, y, w in picks[32:56]:
        cx, cy = x + w - 34, y + 16
        kind = rng.choice(["heart", "star", "check", "heart", "star", "smile"])
        if kind == "heart":
            s.append(("pen", ORANGE, 6, heart(cx, cy, 13)))
        elif kind == "star":
            s.append(("pen", YELLOW, 6, star(cx, cy, 13)))
        elif kind == "check":
            s.append(("pen", INK_BLUE, 6, check(cx - 12, cy, 0.9)))
        else:
            s.append(("pen", PENCIL, 3, ellipse(cx, cy, 12, 12, sweep=2.05 * math.pi, n=28)))
            s.append(("pen", PENCIL, 3, ellipse(cx - 4, cy - 3, 1.2, 1.2, sweep=2 * math.pi, n=6)))
            s.append(("pen", PENCIL, 3, ellipse(cx + 4, cy - 3, 1.2, 1.2, sweep=2 * math.pi, n=6)))
            s.append(("pen", PENCIL, 3, ellipse(cx, cy + 2, 6, 4, start=0.2, sweep=math.pi - 0.4, n=10)))
    # 제목 형광펜
    s.append(("highlighter", YELLOW, 24, line(86, 22, 400, 20)))
    return s


def sparse_layout(me: str):
    return BOXES, doodles()


class Command(BaseCommand):
    help = "샘플(데모)용 노트의 오늘 페이지를 손글씨 메모와 낙서로 채운다."

    def add_arguments(self, parser):
        parser.add_argument("note_id", help="채울 노트(--new를 쓰면 주인·정원을 따라 할 노트)")
        parser.add_argument("--style", choices=["sparse", "dense"], default="sparse", help="간단한 버전 또는 빽빽한 버전")
        parser.add_argument("--new", metavar="이름", help="같은 주인으로 새 노트를 만들어 거기에 채운다")
        parser.add_argument("--force", action="store_true", help="오늘 페이지에 내용이 있어도 지우고 다시 채운다")

    def handle(self, note_id: str, style: str = "sparse", new: str | None = None, force: bool = False, **options):
        note = Note.objects.filter(pk=note_id).first()
        if note is None:
            raise CommandError(f"노트를 찾을 수 없어요: {note_id}")
        if new:
            note = Note.objects.create(name=new, owner=note.owner, member_limit=note.member_limit)
            membership.join(note, note.owner)
        me = NoteMember.objects.filter(note=note, user=note.owner).values_list("nickname", flat=True).first() or "상냥한 토끼"

        page = pages.get_or_create_page(note, clock.today_kst())
        doc: Doc = pages.load_doc(page.id)
        strokes = doc.get("strokes", type=Map)
        boxes = doc.get("textboxes", type=Map)
        if (len(strokes) or len(boxes)) and not force:
            raise CommandError("오늘 페이지에 이미 내용이 있어요. 지우고 다시 채우려면 --force")

        rng.seed(20261015)
        box_specs, stroke_specs = (dense_layout if style == "dense" else sparse_layout)(me)
        before = doc.get_state()
        with doc.transaction():
            for key in list(strokes.keys()):
                del strokes[key]
            for key in list(boxes.keys()):
                del boxes[key]
            base = int(time.time() * 1000)
            for i, (tool, color, width, points) in enumerate(stroke_specs):
                write_stroke(strokes, tool, color, width, points, me if i % 3 else FRIEND, base + i)
            for spec in box_specs:
                write_box(boxes, spec, me)
        update = doc.get_update(before)

        pages.append_update(page.id, update, clock.now())
        pages.compact(page.id)
        # 접속해 있는 사람에게도 바로 보이게 한다.
        async_to_sync(get_channel_layer().group_send)(
            page_group(page.id), {"type": "hub.update", "page": page.id, "update": update, "from": "seed_sample"}
        )
        self.stdout.write(f"'{note.name}'({note.id}) {page.date} 페이지: 글 상자 {len(box_specs)}개, 낙서 {len(stroke_specs)}획")
