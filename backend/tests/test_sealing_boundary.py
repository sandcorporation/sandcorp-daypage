"""장이 바뀌는 순간의 편집 행선 전이표(#268, daypage/boundary.py).

편집 종류 × 받은 시각(닫힌 시각 전·후) × 봉인 방식(정각·바로)을 모두 덮는다. 장부(LateEdits)가 실제 갱신에서 고른
항목도 같은 표를 따르는지 본다.
"""

import datetime as dt

import pytest
from pycrdt import Doc, Map, XmlElement, XmlFragment, XmlText

from daypage import boundary, clock
from daypage.boundary import Destination as D
from daypage.boundary import Kind


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


OPENED = kst(2026, 10, 15)
MS = dt.timedelta(milliseconds=1)

# (opened_at, due_at, sealed_at, 닫힌 시각)
SEALS = {
    # 정각 봉인: 봉인 작업이 몇 초 늦게 돌아도 due_at에 닫혔다
    "정각": (OPENED, OPENED + dt.timedelta(days=1), OPENED + dt.timedelta(days=1, seconds=3), OPENED + dt.timedelta(days=1)),
    # 바로 봉인: 23:30에 봉인 시각을 23시로 당겼다. due_at은 지난 23:00이지만 sealed_at까지 열려 있었다
    "바로": (OPENED, kst(2026, 10, 15, 23), kst(2026, 10, 15, 23, 30), kst(2026, 10, 15, 23, 30)),
}

OLD_STROKE = "oldstroke0000000"
CARRIED_STROKE = "carriedstroke000"
OLD = {
    Kind.STROKE: frozenset({OLD_STROKE}),
    Kind.TEXTBOX: frozenset({"old-box"}),
    Kind.PHOTO: frozenset({"old-photo"}),
    Kind.OTHER: frozenset({"L1/name"}),
}
CARRIED = {Kind.STROKE: {CARRIED_STROKE}, Kind.TEXTBOX: {"carried-box"}, Kind.PHOTO: {"carried-photo"}, Kind.OTHER: set()}

# (편집, 종류, 건드린 키, 닫힌 뒤 행선)
EDITS = [
    ("새 획", Kind.STROKE, "freshstroke00000", D.NEW_PAGE),
    ("앞 장 획의 조각", Kind.STROKE, OLD_STROKE + "a1b2", D.DROP),
    ("옮긴 획의 조각", Kind.STROKE, CARRIED_STROKE + "a1b2", D.NEW_PAGE),
    ("앞 장 획 지우기", Kind.STROKE, OLD_STROKE, D.DROP),
    ("옮긴 획 지우기", Kind.STROKE, CARRIED_STROKE, D.NEW_PAGE),
    ("앞 장 획 옮기기", Kind.STROKE, OLD_STROKE, D.DROP),
    ("옮긴 획 옮기기", Kind.STROKE, CARRIED_STROKE, D.NEW_PAGE),
    ("새 글 상자", Kind.TEXTBOX, "fresh-box", D.NEW_PAGE),
    ("앞 장 글 상자 글자 수정", Kind.TEXTBOX, "old-box", D.DROP),
    ("옮긴 글 상자 글자 수정", Kind.TEXTBOX, "carried-box", D.NEW_PAGE),
    ("새 사진", Kind.PHOTO, "fresh-photo", D.NEW_PAGE),
    ("앞 장 사진 옮기기", Kind.PHOTO, "old-photo", D.DROP),
    ("옮긴 사진 옮기기", Kind.PHOTO, "carried-photo", D.NEW_PAGE),
    ("레이어 바꾸기", Kind.OTHER, "L1/name", D.DROP),
]


def route(kind: Kind, key: str, received_at: dt.datetime, seal: str, sealed: bool = True) -> D:
    opened, due, sealed_at, _ = SEALS[seal]
    origin = boundary.origin_of(kind, key, OLD[kind], CARRIED[kind])
    return boundary.destination(kind, origin, received_at, opened, due, sealed_at if sealed else None)


@pytest.mark.parametrize("seal", list(SEALS))
@pytest.mark.parametrize(("edit", "kind", "key", "after"), EDITS, ids=[e[0] for e in EDITS])
def test_edit_received_before_the_page_closed_stays_on_it(edit, kind, key, after, seal):
    closed = SEALS[seal][3]
    assert route(kind, key, closed - MS, seal) is D.OLD_PAGE


@pytest.mark.parametrize("seal", list(SEALS))
@pytest.mark.parametrize(("edit", "kind", "key", "after"), EDITS, ids=[e[0] for e in EDITS])
def test_edit_received_after_the_page_closed_moves_or_is_dropped(edit, kind, key, after, seal):
    closed = SEALS[seal][3]
    assert route(kind, key, closed, seal) is after
    assert route(kind, key, closed + dt.timedelta(seconds=1), seal) is after


def test_page_moved_to_a_passed_hour_is_open_until_it_is_sealed():
    """(3) 바로 봉인: due_at이 지났어도 봉인 전(sealed_at 없음)에 받은 것은 앞 장이다."""
    opened, due, sealed_at, _ = SEALS["바로"]
    assert boundary.is_open(sealed_at - MS, opened, due, None)
    assert boundary.is_open(sealed_at - MS, opened, due, sealed_at)
    assert not boundary.is_open(sealed_at, opened, due, sealed_at)


def test_full_day_page_closes_at_due_even_before_the_seal_job_runs():
    opened, due, _, _ = SEALS["정각"]
    assert boundary.is_open(due - MS, opened, due, None)
    assert not boundary.is_open(due, opened, due, None)
    assert not boundary.is_open(due + dt.timedelta(hours=1), opened, due, None)


def test_seal_a_few_seconds_late_still_closes_at_due():
    """하루보다 짧은 장도 봉인 작업이 SEAL_DELAY_GRACE 안에 돌았으면 due_at에 닫혔다."""
    opened, due = OPENED, kst(2026, 10, 15, 23)
    sealed = due + dt.timedelta(seconds=5)
    assert boundary.closed_at(opened, due, sealed) == due
    assert not boundary.is_open(due + MS, opened, due, None)


# ── 장부: 실제 갱신에서 항목을 고르고 새 장에 쓴다 ─────────────────


def pen(**extra) -> dict:
    return {"tool": "pen", "author": "a", "points": [1.0, 2.0, 0.5], **extra}


def box() -> Map:
    return Map({"x": 10, "y": 20, "author": "a", "content": XmlFragment()})


def type_into(boxes: Map, key: str, text: str, bold: bool = False) -> None:
    frag = boxes[key]["content"]
    if len(frag.children) == 0:
        frag.children.append(XmlElement("paragraph"))
    para = frag.children[0]
    if len(para.children) == 0:
        para.children.append(XmlText())
    t = para.children[0]
    t.insert(len(t), text, {"bold": True} if bold else None)


class Client:
    """옛 장 문서를 가진 클라이언트. edit 안에서 고친 것을 갱신 하나로 낸다."""

    def __init__(self) -> None:
        self.doc = Doc()
        self.strokes = self.doc.get("strokes", type=Map)
        self.boxes = self.doc.get("textboxes", type=Map)
        self.photos = self.doc.get("photos", type=Map)
        self.layers = self.doc.get("layers", type=Map)

    def edit(self, fn) -> bytes:
        before = self.doc.get_state()
        with self.doc.transaction():
            fn()
        return self.doc.get_update(before)


CLOSED = SEALS["정각"][3]


def take(ledger: boundary.LateEdits, update: bytes) -> tuple[boundary.Routed, Doc]:
    late = ledger.doc()
    routed = boundary.route_late(ledger, late, update, CLOSED, *SEALS["정각"][:2], SEALS["정각"][2])
    ledger.state = late.get_update()
    return routed, late


def new_page_after(target: Doc, late: Doc, routed: boundary.Routed) -> None:
    boundary.write_moved(target, late, routed.moved)


def test_ledger_moves_new_things_and_counts_edits_to_old_ones():
    c = Client()
    c.edit(lambda: c.strokes.update({OLD_STROKE: Map(pen())}))
    c.edit(lambda: c.boxes.update({"old-box": box()}))
    c.edit(lambda: type_into(c.boxes, "old-box", "앞 장 글"))
    c.edit(lambda: c.boxes.update({"empty-box": box()}))
    ledger = boundary.LateEdits()
    ledger.start(c.doc.get_update())

    def late_edits():
        # 앞 장 획을 지우개로 자름(조각 둘 + 원래 획 지우기) — 하나로 센다
        c.strokes[OLD_STROKE + "aaaa"] = Map(pen())
        c.strokes[OLD_STROKE + "bbbb"] = Map(pen())
        del c.strokes[OLD_STROKE]
        # 앞 장 글 상자에 글자 — 하나
        type_into(c.boxes, "old-box", "!")
        # 레이어 이름 — 하나
        c.layers["L1/name"] = "새 이름"
        # 새로 그은 획(레이어는 옛 장의 것), 새 글 상자, 새 사진
        c.strokes["freshstroke00000"] = Map(pen(layer="L1", pts=b"\x01\x02"))
        c.boxes["fresh-box"] = box()
        c.photos["fresh-photo"] = Map({"src": "p" * 32, "createdAt": 1, "x": 0})

    routed, late = take(ledger, c.edit(late_edits))

    assert routed.lost == 3
    assert sorted(routed.moved) == [("photos", "fresh-photo"), ("strokes", "freshstroke00000"), ("textboxes", "fresh-box")]
    assert routed.photos == {"p" * 32}

    # 봉인 때 빠질 빈 글 상자에 친 글자는 상자째 옮긴다(issue 1)
    routed, late = take(ledger, c.edit(lambda: type_into(c.boxes, "empty-box", "봉인 직전 상자", bold=True)))
    assert routed.lost == 0
    assert routed.moved == [("textboxes", "empty-box")]
    target = Doc()
    new_page_after(target, late, routed)
    content = target.get("textboxes", type=Map)["empty-box"]["content"]
    assert str(content) == "<paragraph><bold>봉인 직전 상자</bold></paragraph>"


def test_ledger_follows_later_edits_to_a_carried_stroke():
    """(2) 옮긴 획을 바로 자르거나 옮기면 새 장에서도 그대로 된다(원래 획과 조각이 겹치지 않는다)."""
    c = Client()
    ledger = boundary.LateEdits()
    ledger.start(c.doc.get_update())
    target = Doc()
    s = "latestroke000000"

    routed, late = take(ledger, c.edit(lambda: c.strokes.update({s: Map(pen(layer="L1"))})))
    new_page_after(target, late, routed)
    assert set(target.get("strokes", type=Map).keys()) == {s}
    assert "layer" not in target.get("strokes", type=Map)[s]

    routed, late = take(ledger, c.edit(lambda: c.strokes[s].update({"points": [9.0, 9.0, 0.5]})))
    new_page_after(target, late, routed)
    assert target.get("strokes", type=Map)[s]["points"] == [9.0, 9.0, 0.5]

    def cut():
        c.strokes[s + "aaaa"] = Map(pen())
        del c.strokes[s]

    routed, late = take(ledger, c.edit(cut))
    new_page_after(target, late, routed)
    assert routed.lost == 0
    assert set(target.get("strokes", type=Map).keys()) == {s + "aaaa"}
