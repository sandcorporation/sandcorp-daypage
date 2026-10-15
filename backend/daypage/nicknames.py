"""노트 안에서 쓰는 `형용사 + 이름씨` 랜덤 닉네임과 참여자 색."""

import random
from collections import Counter
from collections.abc import Iterable

ADJECTIVES = (
    "졸린", "용감한", "푸른", "수줍은", "배고픈", "신난", "느긋한", "반짝이는",
    "동그란", "말랑한", "씩씩한", "상냥한", "엉뚱한", "조용한", "부지런한", "다정한",
    "포근한", "재빠른", "꼼꼼한", "명랑한", "차분한", "행복한", "깜찍한", "따뜻한",
    "시원한", "달콤한", "노란", "하얀", "작은", "커다란", "쾌활한", "늠름한",
    "의젓한", "날쌘", "똑똑한", "산뜻한", "보송보송한", "든든한", "궁금한", "새침한",
)

NOUNS = (
    # 동물
    "수달", "펭귄", "고양이", "강아지", "토끼", "다람쥐", "햄스터", "판다",
    "코알라", "여우", "너구리", "부엉이", "고래", "돌고래", "해달", "오리",
    "병아리", "거북이", "고슴도치", "알파카", "기린", "코끼리", "사자", "호랑이", "곰",
    # 귀여운 사물
    "고구마", "감자", "만두", "찐빵", "호빵", "도토리", "솜사탕", "젤리",
    "마카롱", "붕어빵", "경단", "단추", "구름", "양말", "풍선",
)

# 흰 글씨를 올려도 대비 4.5:1 이상인 진한 색
MEMBER_COLORS = (
    "#2A47B0",
    "#C2410C",
    "#16794F",
    "#6D28D9",
    "#B91C1C",
    "#0E7490",
    "#A21CAF",
    "#4D7C0F",
    "#BE185D",
    "#1D4ED8",
    "#92400E",
    "#374151",
)


def pick_nickname(used: Iterable[str], rng: random.Random | None = None) -> str:
    """노트 안에서 아직 쓰지 않은 조합을 무작위로 고른다. 모두 쓰였으면 번호를 붙인다."""
    rng = rng or random.Random()
    used = set(used)
    free = [f"{a} {n}" for a in ADJECTIVES for n in NOUNS if f"{a} {n}" not in used]
    if free:
        return rng.choice(free)
    suffix = 2
    while True:
        candidate = f"{rng.choice(ADJECTIVES)} {rng.choice(NOUNS)} {suffix}"
        if candidate not in used:
            return candidate
        suffix += 1


def pick_color(used: Iterable[str], rng: random.Random | None = None) -> str:
    """노트 안에서 가장 적게 쓰인 색 중 하나를 고른다."""
    rng = rng or random.Random()
    counts = Counter({c: 0 for c in MEMBER_COLORS})
    counts.update(c for c in used if c in counts)
    least = min(counts.values())
    return rng.choice([c for c, n in counts.items() if n == least])
