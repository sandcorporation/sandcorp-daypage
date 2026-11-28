"""장이 바뀌는 순간의 편집이 갈 곳(#266, #268).

경계 편집의 행선(앞 장 / 새 장의 같은 자리 / 버리고 알림)은 destination 하나가 정한다. pages·hub·consumers는
이 모듈로만 판정한다.

- 받은 시각이 그 장이 실제로 닫힌 시각 전이면 앞 장에 넣는다.
- 뒤면 새 장의 같은 자리로 옮긴다. 다만 앞 장에 남은 것을 고친 편집(지우기·옮기기·조각·글자 수정)은 새 장에 그
  대상이 없어 옮길 수 없다: 버리고 그 수를 사용자에게 알린다.
- 닫힌 시각은 정각 봉인이면 due_at, 바로 봉인(봉인 시각을 이미 지난 시각으로 바꿈)이면 sealed_at.
"""

import datetime as dt
import enum
from dataclasses import dataclass, field

from pycrdt import Doc, Map, XmlElement, XmlFragment, XmlText

# 봉인이 예정보다 이만큼 안에서 늦은 것은 제때 봉인으로 본다(봉인 작업이 몇 초 늦게 돈다)
SEAL_DELAY_GRACE = dt.timedelta(minutes=1)
FULL_DAY = dt.timedelta(days=1)

STROKES, TEXTBOXES, PHOTOS = "strokes", "textboxes", "photos"
# 새 장으로 옮길 수 있는 맵. 레이어 등 나머지는 장마다 따로라 옮기지 않는다(meta는 장이 정한다).
CARRYABLE = (STROKES, TEXTBOXES, PHOTOS)
IGNORED = ("meta",)


class Kind(enum.StrEnum):
    STROKE = "stroke"
    TEXTBOX = "textbox"
    PHOTO = "photo"
    OTHER = "other"  # 레이어 등


KIND_OF_MAP = {STROKES: Kind.STROKE, TEXTBOXES: Kind.TEXTBOX, PHOTOS: Kind.PHOTO}


class Origin(enum.StrEnum):
    NEW = "new"  # 앞 장에 없는 것(새로 만든 것, 봉인 때 빠질 빈 글 상자)
    OLD = "old"  # 앞 장에 남은 것(그 조각 포함)
    CARRIED = "carried"  # 앞서 새 장으로 옮긴 것(그 조각 포함)


class Destination(enum.StrEnum):
    OLD_PAGE = "old_page"
    NEW_PAGE = "new_page"
    DROP = "drop"


def closed_at(opened_at: dt.datetime, due_at: dt.datetime, sealed_at: dt.datetime) -> dt.datetime:
    """봉인된 장이 실제로 닫힌 순간.

    대개 due_at이다(정각 봉인). 주인이 봉인 시각을 이미 지난 시각으로 바꿔 바로 봉인한 장만 due_at이 지난 경계로
    당겨져 있어 sealed_at까지 열려 있었다. 꼬박 하루짜리 장은 바로 봉인될 수 없으므로 봉인 작업이 오래 밀렸어도 due_at이다.
    """
    if due_at - opened_at == FULL_DAY or sealed_at - due_at < SEAL_DELAY_GRACE:
        return due_at
    return sealed_at


def is_open(received_at: dt.datetime, opened_at: dt.datetime, due_at: dt.datetime, sealed_at: dt.datetime | None) -> bool:
    """received_at에 받은 편집을 이 장에 넣는가(그 장이 그때 아직 열려 있었나).

    봉인 전인 장은 봉인되는 순간(지금 이후)을 모른다. 하루보다 짧은 장이 due_at을 SEAL_DELAY_GRACE 넘게 지났으면
    바로 봉인이 도는 중이다(sealed_at > received_at): 아직 열려 있다.
    """
    if sealed_at is not None:
        return received_at < closed_at(opened_at, due_at, sealed_at)
    if received_at < due_at:
        return True
    return due_at - opened_at != FULL_DAY and received_at - due_at >= SEAL_DELAY_GRACE


def past_due(received_at: dt.datetime, due_at: dt.datetime | None) -> bool:
    """연결이 아는 봉인 예정만으로 본 첫 판정(DB를 기다리지 않는다). True여도 장이 아직 열려 있을 수 있어 destination이 다시 본다."""
    return due_at is not None and received_at >= due_at


def destination(
    kind: Kind,
    origin: Origin,
    received_at: dt.datetime,
    opened_at: dt.datetime,
    due_at: dt.datetime,
    sealed_at: dt.datetime | None,
) -> Destination:
    """경계 편집 하나의 행선."""
    if is_open(received_at, opened_at, due_at, sealed_at):
        return Destination.OLD_PAGE
    if kind is Kind.OTHER or origin is Origin.OLD:
        return Destination.DROP
    return Destination.NEW_PAGE


def piece_prefix(key: str) -> str:
    """지우개가 자른 조각은 원래 획 id의 앞 16자를 잇는다(frontend/src/page/doc.ts pieceId)."""
    return key[:16]


def origin_of(kind: Kind, key: str, old: frozenset[str], carried: set[str]) -> Origin:
    """편집한 항목(맵 키)이 어디 있던 것인가. old·carried는 그 맵의 키 집합(앞 장에 남은 것 / 새 장으로 옮긴 것)."""
    if key in carried:
        return Origin.CARRIED
    if key in old:
        return Origin.OLD
    if kind is Kind.STROKE:
        prefix = piece_prefix(key)
        if any(piece_prefix(k) == prefix for k in carried):
            return Origin.CARRIED
        if any(piece_prefix(k) == prefix for k in old):
            return Origin.OLD
    return Origin.NEW


def lost_group(kind: Kind, map_name: str, key: str) -> tuple[str, str]:
    """버린 편집을 셀 단위. 한 획을 지우개로 자른 조각들과 원래 획 지우기는 하나로, 레이어 하나의 필드들도 하나로 센다."""
    if kind is Kind.STROKE:
        return map_name, piece_prefix(key)
    if kind is Kind.OTHER:
        return map_name, key.split("/", 1)[0]
    return map_name, key


# ── 늦은 편집 장부(방마다 하나) ──────────────────────────────────


def has_text(node) -> bool:
    """글 상자 내용(XmlFragment) 안에 글자가 하나라도 있는지"""
    if isinstance(node, XmlText):
        return len(node) > 0
    return any(has_text(child) for child in getattr(node, "children", []))


def _is_empty_box(value) -> bool:
    content = value.get("content") if isinstance(value, Map) else None
    return isinstance(content, XmlFragment) and not has_text(content)


@dataclass
class LateEdits:
    """닫힌 장으로 온 편집을 차례로 받는 장부. 방(hub.Room) 하나에 하나, 이벤트 루프가 잠금을 쥔 채 DB 스레드에서 쓴다.

    base는 앞 장에 남는 내용(바이트, 없으면 처음 쓸 때 저장된 장 문서를 읽는다). state는 base에 늦은 편집을 모두 더한
    문서라, 옮긴 획을 다시 고친 편집도 그 획의 지금 모습으로 읽는다. pycrdt Doc은 만든 스레드에서만 쓰므로 바이트로 둔다.
    """

    base: bytes | None = None
    state: bytes | None = None
    old: dict[str, frozenset[str]] = field(default_factory=dict)
    carried: dict[str, set[str]] = field(default_factory=lambda: {name: set() for name in CARRYABLE})

    def start(self, base: bytes) -> None:
        doc = Doc()
        doc.apply_update(base)
        self.old = {}
        for name in CARRYABLE:
            m = doc.get(name, type=Map)
            # 빈 글 상자는 봉인 때 빠진다(sealing._settle): 앞 장에 남지 않으니 그 상자에 친 글자는 상자째 옮긴다
            self.old[name] = frozenset(k for k, v in m.items() if not (name == TEXTBOXES and _is_empty_box(v)))
        self.base = base
        self.state = base

    def doc(self) -> Doc:
        doc = Doc()
        if self.state:
            doc.apply_update(self.state)
        return doc


def touched(doc: Doc, update: bytes) -> list[tuple[str, str]]:
    """update를 doc에 더하고, 그 편집이 건드린 (맵 이름, 맵 키)를 돌려준다(새로 만든 것·고친 것·지운 것)."""
    # 늘 쓰는 맵은 처음 쓰는 갱신이어도 지켜본다. 그 밖의 맵(레이어 등)은 문서에 이미 있으면 지켜보고, 이 갱신이 처음
    # 만든 것이면 더한 뒤 그 안의 키를 모두 건드린 것으로 본다.
    names = list(dict.fromkeys([*CARRYABLE, *(n for n in doc.keys() if n not in IGNORED)]))
    seen: dict[tuple[str, str], None] = {}

    def watcher(name: str):
        def on_events(events) -> None:
            for event in events:
                path = list(getattr(event, "path", []))
                if path:
                    seen[(name, str(path[0]))] = None
                else:
                    for key in getattr(event, "keys", {}):
                        seen[(name, str(key))] = None

        return on_events

    subs = []
    for name in names:
        m = doc.get(name, type=Map)
        subs.append((m, m.observe_deep(watcher(name))))
    try:
        doc.apply_update(update)
    finally:
        for m, sub in subs:
            m.unobserve(sub)
    for name in doc.keys():
        if name not in names and name not in IGNORED:
            for key in doc.get(name, type=Map).keys():
                seen[(name, str(key))] = None
    return list(seen)


def copy_value(target: Map, key: str, value) -> None:
    """다른 문서의 값을 target[key]에 깊이 복사한다(글 상자 내용의 서식까지). target은 문서에 붙어 있어야 한다."""
    if isinstance(value, Map):
        target[key] = Map()
        inner = target[key]
        for k, v in value.items():
            copy_value(inner, k, v)
    elif isinstance(value, XmlFragment) and not isinstance(value, XmlElement):
        target[key] = XmlFragment()
        _copy_children(target[key], value)
    elif isinstance(value, bytearray):
        target[key] = bytes(value)
    else:
        target[key] = value


def _copy_children(target, source) -> None:
    for child in source.children:
        if isinstance(child, XmlText):
            text = XmlText()
            target.children.append(text)
            for chunk, attrs in child.diff():
                if isinstance(chunk, str):
                    text.insert(len(text), chunk, attrs or None)
                else:
                    text.insert_embed(len(text), chunk, attrs or None)
        elif isinstance(child, XmlElement):
            element = XmlElement(child.tag, dict(child.attributes))
            target.children.append(element)
            _copy_children(element, child)


@dataclass
class Routed:
    """늦은 편집 하나를 나눈 결과. moved는 새 장 문서에 쓸 (맵 이름, 키) — 값이 없으면 지운다."""

    moved: list[tuple[str, str]]
    lost: int
    photos: set[str]


def route_late(
    ledger: LateEdits,
    late: Doc,
    update: bytes,
    received_at: dt.datetime,
    opened_at: dt.datetime,
    due_at: dt.datetime,
    sealed_at: dt.datetime | None,
) -> Routed:
    """닫힌 장으로 온 update를 late(장부 문서)에 더하고 항목마다 행선을 정한다. 옮길 것은 장부의 carried에 더한다."""
    moved: list[tuple[str, str]] = []
    lost: set[tuple[str, str]] = set()
    photo_src: set[str] = set()
    for name, key in touched(late, update):
        kind = KIND_OF_MAP.get(name, Kind.OTHER)
        old = ledger.old.get(name, frozenset())
        carried = ledger.carried.setdefault(name, set())
        origin = origin_of(kind, key, old, carried)
        dest = destination(kind, origin, received_at, opened_at, due_at, sealed_at)
        if dest is Destination.DROP:
            lost.add(lost_group(kind, name, key))
            continue
        if dest is Destination.OLD_PAGE:
            # 부르는 쪽이 is_open으로 먼저 걸러 앞 장에 넣는다: 여기 오지 않는다
            continue
        carried.add(key)
        moved.append((name, key))
        if kind is Kind.PHOTO:
            value = late.get(name, type=Map).get(key)
            if isinstance(value, Map) and isinstance(value.get("src"), str):
                photo_src.add(value.get("src"))
    return Routed(moved=moved, lost=len(lost), photos=photo_src)


def write_moved(target: Doc, late: Doc, moved: list[tuple[str, str]]) -> None:
    """옮길 항목을 새 장 문서 target의 같은 키에 장부 문서 late의 지금 모습대로 쓴다(없어졌으면 지운다)."""
    with target.transaction():
        for name, key in moved:
            source = late.get(name, type=Map)
            dest = target.get(name, type=Map)
            value = source.get(key)
            if value is None:
                if key in dest:
                    del dest[key]
                continue
            copy_value(dest, key, value)
            if name == STROKES:
                # 레이어는 옛 장의 것이라 새 장에 없다: 기본 레이어에 둔다
                inner = dest.get(key)
                if isinstance(inner, Map) and "layer" in inner:
                    del inner["layer"]
