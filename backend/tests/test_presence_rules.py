"""접속 상태(awareness) 규칙 표 시험(#238). 각 행은 #228·#230·#232·#233 가운데 한 시나리오다."""

import pytest

from daypage.presence_rules import (
    PRESENCE_TTL,
    Holder,
    Seat,
    Slot,
    Verdict,
    alive,
    arrival,
    batch,
    deferred,
    deliveries,
    farewell,
    receive,
)

# 연결: 사용자 1(앨리스)의 옛 연결·새 연결, 사용자 2(밥)의 연결
OLD, NEW, BOB = "앨리스-옛", "앨리스-새", "밥"
ALICE_ID, BOB_ID = 1, 2
USER = {OLD: ALICE_ID, NEW: ALICE_ID, BOB: BOB_ID}
CURSOR = {"cursor": {"x": 1, "y": 1}}


def holder(conn: str) -> Holder:
    return Holder(conn, USER[conn])


# ── 받기 ─────────────────────────────────────────────────────
# 행: (보낸 연결, 보낸 연결이 쥔 clientID·shift, 항목 clientID·clock·상태, 그 clientID를 쥔 연결,
#      방에 살아 있는지, 방이 본 마지막 clock) → 기대 결정
RECEIVE = [
    # 처음 상태: 아무도 쥐지 않았고 방에 없다 → 쥐고 그대로 받는다
    ("첫 상태로 쥔다", BOB, None, 0, (20, 1, CURSOR), None, False, -1, Verdict(True, 1, claim=True, shift=0)),
    # 처음 항목이 null이면 쥐지 않는다
    ("첫 항목이 null이면 쥐지 않는다", BOB, None, 0, (20, 1, None), None, False, -1, Verdict(False)),
    # #228: 밥 클라이언트가 되돌려 보낸 앨리스의 커서·null은 버린다
    ("#228 남이 쥔 것을 첫 항목으로 보내면 버린다", BOB, None, 0, (10, 5, CURSOR), OLD, True, 4, Verdict(False)),
    ("#228 자기 것을 쥔 뒤 남의 커서를 보내면 버린다", BOB, 20, 0, (10, 6, CURSOR), OLD, True, 5, Verdict(False)),
    ("#228 자기 것을 쥔 뒤 남의 null을 보내면 버린다", BOB, 20, 0, (10, 6, None), OLD, True, 5, Verdict(False)),
    ("#228 다른 프로세스가 퍼뜨린 살아 있는 것은 쥐지 않는다", BOB, None, 0, (30, 3, CURSOR), None, True, 3, Verdict(False)),
    # 자기 것: 쥔 뒤 보낸 상태·null은 shift를 더해 받는다
    ("자기 커서", OLD, 10, 0, (10, 7, CURSOR), OLD, True, 6, Verdict(True, 7)),
    ("자기 null", OLD, 10, 0, (10, 8, None), OLD, True, 7, Verdict(True, 8)),
    ("shift 붙은 자기 커서", NEW, 10, 7, (10, 2, CURSOR), NEW, True, 8, Verdict(True, 9)),
    # #230: 옛 연결이 반쯤 열린 채 쥐고 있어도 같은 사용자의 새 연결이 넘겨받는다. clock은 방이 본 뒤로 잇는다
    ("#230 반쯤 열린 옛 연결에게서 넘겨받고 clock을 잇는다", NEW, None, 0, (10, 0, CURSOR), OLD, True, 7,
     Verdict(True, 8, claim=True, shift=8)),
    ("#230 반쯤 열린 옛 연결, 새 clock이 더 크면 shift 없음", NEW, None, 0, (10, 12, CURSOR), OLD, True, 7,
     Verdict(True, 12, claim=True, shift=0)),
    # #230: 옛 연결이 끊겨 null을 알린 뒤(쥔 연결 없음, 방에 없음, 마지막 clock은 남음)
    ("#230 끊긴 옛 연결 뒤 다시 쥐고 clock을 잇는다", NEW, None, 0, (10, 0, CURSOR), None, False, 8,
     Verdict(True, 9, claim=True, shift=9)),
    # #230: 넘겨준 옛 연결은 더 바꾸지도 지우지도 못한다
    ("#230 넘겨준 옛 연결의 커서는 버린다", OLD, 10, 0, (10, 8, CURSOR), NEW, True, 9, Verdict(False)),
    ("#230 넘겨준 옛 연결의 null은 버린다", OLD, 10, 0, (10, 8, None), NEW, True, 9, Verdict(False)),
    # #228: 다른 사용자가 쥔 clientID는 넘겨받지 못한다
    ("#228 다른 사용자의 것은 넘겨받지 못한다", BOB, None, 0, (10, 0, CURSOR), NEW, True, 9, Verdict(False)),
]


@pytest.mark.parametrize(
    ("sender", "own", "shift", "entry", "held_by", "is_alive", "last_clock", "expected"),
    [row[1:] for row in RECEIVE],
    ids=[row[0] for row in RECEIVE],
)
def test_receive(sender, own, shift, entry, held_by, is_alive, last_clock, expected):
    seat = Seat(sender, USER[sender], own, shift)
    slot = Slot(holder(held_by) if held_by else None, is_alive, last_clock)
    assert receive(seat, *entry, slot) == expected


# ── 끊김 ─────────────────────────────────────────────────────
# 행: (나가는 연결, 그 연결이 쥔 clientID, 마지막으로 퍼뜨린 clock, 지금 그 clientID를 쥔 연결) → null 알림
FAREWELL = [
    ("#228 쥔 자기 것만 clock+1 null로 지운다", OLD, 10, 7, OLD, (10, 8, None)),
    ("이미 null을 보냈으면 알리지 않는다", OLD, 10, None, OLD, None),
    ("#230 새 연결에 넘겨준 옛 연결은 알리지 않는다", OLD, 10, 7, NEW, None),
    ("clientID를 정하기 전에 나가면 알리지 않는다", BOB, None, None, None, None),
]


@pytest.mark.parametrize(
    ("leaver", "own", "last", "held_by", "expected"), [row[1:] for row in FAREWELL], ids=[row[0] for row in FAREWELL]
)
def test_farewell(leaver, own, last, held_by, expected):
    slot = Slot(holder(held_by) if held_by else None, held_by is not None, last if last is not None else -1)
    assert farewell(Seat(leaver, USER[leaver], own), last, slot) == expected


# ── 보내기 ───────────────────────────────────────────────────
# 행: (묶음 clientID들, clientID를 쥔 연결) → 연결마다 받을 clientID(None이면 묶음 그대로, 없으면 안 받음)
DELIVERIES = [
    ("쥔 사람 없는 묶음(다른 프로세스)은 모두 그대로", [30], {}, {OLD: None, NEW: None, BOB: None}),
    ("#232 자기 것만 든 묶음은 쥔 연결이 받지 않는다", [10], {10: NEW}, {OLD: None, BOB: None}),
    ("#232 섞인 묶음은 쥔 연결에게 자기 것을 빼고 보낸다", [10, 20], {10: NEW, 20: BOB}, {OLD: None, NEW: [20], BOB: [10]}),
    ("#232 넘겨준 옛 연결은 쥔 것이 없어 그대로 받는다", [10], {10: NEW}, {OLD: None, BOB: None}),
    ("#228 다른 사용자 묶음도 자기 것만 뺀다", [10, 20, 30], {10: OLD, 20: BOB}, {OLD: [20, 30], NEW: None, BOB: [10, 30]}),
]


@pytest.mark.parametrize(
    ("ids", "holders", "expected"), [row[1:] for row in DELIVERIES], ids=[row[0] for row in DELIVERIES]
)
def test_deliveries(ids, holders, expected):
    entries = [(cid, 1, CURSOR) for cid in ids]
    holders = {cid: holder(conn) for cid, conn in holders.items()}
    got = {m: None if rest is None else [e[0] for e in rest] for m, rest in deliveries(entries, [OLD, NEW, BOB], holders)}
    assert got == expected


# ── 들어올 때 ────────────────────────────────────────────────
# 행: (방에 살아 있는 clientID와 쥔 연결, 들어오는 사용자, 첫 awareness로 정해진 clientID)
#     → 바로 보낼 clientID, 정해진 뒤 보낼 clientID
ARRIVAL = [
    ("#233 다른 사용자가 쥔 것은 바로 보낸다", {20: BOB}, ALICE_ID, 10, [20], []),
    ("#233 같은 사용자가 쥔 자기 옛 항목은 정해진 뒤 빼고 보낸다", {10: OLD, 20: BOB}, ALICE_ID, 10, [20], []),
    ("#233 같은 사용자의 다른 탭 커서는 정해진 뒤 보낸다", {11: OLD, 20: BOB}, ALICE_ID, 10, [20], [11]),
    ("#233 다른 프로세스에서 온 것은 미뤘다가 자기 것이 아니면 보낸다", {30: None, 31: None}, ALICE_ID, 30, [], [31]),
]


@pytest.mark.parametrize(
    ("room", "user_id", "chosen", "now_ids", "later_ids"), [row[1:] for row in ARRIVAL], ids=[row[0] for row in ARRIVAL]
)
def test_arrival(room, user_id, chosen, now_ids, later_ids):
    entries = [(cid, 1, CURSOR) for cid in room]
    holders = {cid: holder(conn) for cid, conn in room.items() if conn}
    now, later = arrival(entries, user_id, holders)
    assert [e[0] for e in now] == now_ids
    assert [e[0] for e in deferred(later, chosen, entries)] == later_ids


# ── 모아 보내기·살아 있음 ─────────────────────────────────────


def test_batch_keeps_the_newest_clock_per_client_id():
    pending = batch({}, [(10, 3, CURSOR), (20, 1, CURSOR)])
    pending = batch(pending, [(10, 2, {"old": 1}), (10, 4, None), (20, 1, {"same": 1})])
    assert pending == {10: (4, None), 20: (1, {"same": 1})}


def test_alive_until_ttl():
    assert alive(0.0, PRESENCE_TTL - 0.1)
    assert not alive(0.0, PRESENCE_TTL)
