"""접속 상태(awareness) 규칙. 결정만 하는 순수 함수 모음이다(#238).

소켓·채널 레이어·방(hub.Room)의 상태와 떨어져 있다. 연결(consumers)과 방(hub)은 지금 상태를 여기 넘겨 받은
결정을 따르기만 한다. 규칙이 두 파일에 흩어져 있어 길 하나를 고칠 때 옆 길을 놓쳤다(#228·#230·#232·#233).

- 받기(receive): 연결이 보낸 항목을 받아들일지, 그 clientID를 쥘지, clock을 얼마로 바꿀지
- 보내기(deliveries): 커서 묶음을 어느 연결에게 무엇만 보낼지
- 끊김(farewell): 나가는 연결이 무엇을 null로 알릴지
- 들어올 때(arrival·deferred): 지금 커서 가운데 무엇을 바로 보내고 무엇을 clientID가 정해진 뒤로 미룰지

y-protocols 클라이언트가 하는 일
- 받은 남의 awareness도 그대로 다시 보내고, 시간이 지나면 남의 것을 null로 보낸다.
- 자기 clientID라도 clock이 더 크면 받아들여 자기 상태를 덮는다.
- 다시 연결하면 provider를 새로 만들어 clock을 처음부터 센다. 남의 화면은 옛 clock보다 작은 것을 버린다.
"""

from collections.abc import Hashable, Iterable, Mapping
from dataclasses import dataclass

from .awareness import Entry

# 이 시간(초) 동안 갱신되지 않은 커서는 방에 없는 것으로 친다. 클라이언트는 15초마다 갱신한다.
PRESENCE_TTL = 35


@dataclass(frozen=True)
class Holder:
    """이 프로세스에서 clientID를 쥔 연결과 그 사용자."""

    conn: Hashable
    user_id: int


@dataclass(frozen=True)
class Slot:
    """방이 아는 clientID 하나."""

    # 이 프로세스에서 쥔 연결. 옛 연결이 끊긴 줄 모른 채 남아 있으면(반쯤 열림) 그 연결이다.
    holder: Holder | None = None
    # 커서가 방에 살아 있다(TTL 안). 다른 프로세스가 퍼뜨린 것도 여기 든다.
    alive: bool = False
    # 방에 알려진 마지막 clock. 지운 뒤에도 남는다. 없으면 -1.
    last_clock: int = -1


@dataclass(frozen=True)
class Seat:
    """항목을 보낸 연결."""

    conn: Hashable
    user_id: int
    # 이 연결이 쥔 clientID(첫 상태로 정해진다)와 받은 clock에 더하는 값
    client_id: int | None = None
    shift: int = 0


@dataclass(frozen=True)
class Verdict:
    """받은 항목 하나에 대한 결정."""

    accept: bool
    # 받아들이면 퍼뜨릴 clock(shift를 더한 값)
    clock: int = 0
    # 이 연결이 이 clientID를 쥔다(넘겨받기 포함). 연결은 client_id·shift를 정하고 방은 holder를 바꾼다.
    claim: bool = False
    shift: int = 0


def alive(at: float, now: float) -> bool:
    """at에 받은 커서가 now에도 살아 있는가."""
    return now - at < PRESENCE_TTL


def can_claim(user_id: int, slot: Slot) -> bool:
    """사용자 user_id의 연결이 이 clientID를 쥘 수 있는가.

    쥔 연결이 없으면 방에 살아 있지 않을 때만(다른 프로세스가 퍼뜨린 것도 아닐 때만) 쥔다. 같은 사용자의 다른
    연결이 쥐고 있으면 넘겨받는다: 다시 연결한 클라이언트는 같은 clientID를 쓰는데 옛 연결은 끊긴 줄 모른 채
    한동안 남는다(#230). 다른 사용자의 연결이 쥔 것은 넘겨받지 못한다(#228).
    """
    if slot.holder is None:
        return not slot.alive
    return slot.holder.user_id == user_id


def receive(seat: Seat, client_id: int, clk: int, state: dict | None, slot: Slot) -> Verdict:
    """연결 seat가 보낸 항목 (client_id, clk, state)를 받아들일지(#228·#230).

    연결마다 자기 clientID 하나만 받는다. 아직 정하지 않았으면 처음 상태(null 아님)를 보낸 clientID를 쥘 수 있을
    때 쥔다. 연결을 열자마자 자기 상태를 먼저 보내므로 보통 첫 항목이 자기 것이다. 쥐면서 clock을 방이 본 마지막
    clock 뒤로 잇는 shift를 정한다(다시 연결한 클라이언트는 clock을 처음부터 센다, #230). 넘겨준 옛 연결은 그
    clientID를 더 바꾸지도 지우지도 못한다.
    """
    if seat.client_id is None and state is not None and can_claim(seat.user_id, slot):
        shift = max(0, slot.last_clock + 1 - clk)
        return Verdict(accept=True, clock=clk + shift, claim=True, shift=shift)
    if client_id == seat.client_id and slot.holder is not None and slot.holder.conn is seat.conn:
        return Verdict(accept=True, clock=clk + seat.shift)
    return Verdict(accept=False)


def restate(state: dict, nickname: str, color: str) -> dict:
    """받아들인 상태에서 커서만 두고, 닉네임·색은 클라이언트가 보낸 값 대신 서버가 배정한 값으로 바꾼다."""
    return {
        "cursor": state.get("cursor"),
        "editingBoxId": state.get("editingBoxId"),
        "nickname": nickname,
        "color": color,
    }


def farewell(seat: Seat, last_clock: int | None, slot: Slot) -> Entry | None:
    """나가는 연결이 다른 사람 화면에서 지울 항목(#228).

    지금 쥔 자기 clientID만 지운다. 이미 null을 보냈으면(last_clock None) 지울 것이 없고, 같은 사용자의 새 연결에
    넘겨준 뒤면 새 연결의 커서이므로 건드리지 않는다(#230).
    """
    if last_clock is None or slot.holder is None or slot.holder.conn is not seat.conn:
        return None
    return (seat.client_id, last_clock + 1, None)


def batch(pending: Mapping[int, tuple[int, dict | None]], entries: Iterable[Entry]) -> dict[int, tuple[int, dict | None]]:
    """아직 보내지 않은 커서에 새 항목을 더한다. 같은 clientID는 clock이 작지 않은 것이 이긴다."""
    out = dict(pending)
    for client_id, clk, state in entries:
        prev = out.get(client_id)
        if prev is None or clk >= prev[0]:
            out[client_id] = (clk, state)
    return out


def deliveries(
    entries: list[Entry], members: Iterable[Hashable], holders: Mapping[int, Holder]
) -> list[tuple[Hashable, list[Entry] | None]]:
    """커서 묶음을 받을 연결과 그 연결에게 보낼 항목(None이면 묶음 그대로)(#232).

    받는 연결이 쥔 clientID의 항목은 뺀다. 다시 연결한 연결은 clock에 shift를 더해 퍼뜨리므로(#230), 되돌려 받으면
    지난 상태로 자기 커서를 덮고 clock을 키워 되풀이된다. 빼고 남는 것이 없는 연결에게는 보내지 않는다.
    """
    own: dict[Hashable, set[int]] = {}
    for client_id, _, _ in entries:
        if (holder := holders.get(client_id)) is not None:
            own.setdefault(holder.conn, set()).add(client_id)
    out: list[tuple[Hashable, list[Entry] | None]] = []
    for m in members:
        skip = own.get(m)
        if not skip:
            out.append((m, None))
        elif rest := [e for e in entries if e[0] not in skip]:
            out.append((m, rest))
    return out


def arrival(entries: list[Entry], user_id: int, holders: Mapping[int, Holder]) -> tuple[list[Entry], set[int]]:
    """들어오는 사용자 user_id의 연결에게 지금 커서 가운데 바로 보낼 것과 미룰 clientID(#233).

    다시 연결한 새 provider가 자기 옛 항목을 받으면 옛 커서·editingBoxId로 자기 상태를 덮는다. 이 연결이 쓸
    clientID는 첫 awareness에서야 정해진다. 이 프로세스에서 다른 사용자가 쥔 것만 바로 보내고, 자기 것일 수 있는
    것(같은 사용자가 쥔 것, 다른 프로세스에서 온 것)은 clientID가 정해진 뒤로 미룬다(deferred).
    """
    now: list[Entry] = []
    later: set[int] = set()
    for entry in entries:
        holder = holders.get(entry[0])
        if holder is not None and holder.user_id != user_id:
            now.append(entry)
        else:
            later.add(entry[0])
    return now, later


def deferred(later: set[int], client_id: int, entries: list[Entry]) -> list[Entry]:
    """clientID가 client_id로 정해진 연결에게 미뤄 둔 커서 가운데 지금 보낼 것(자기 것은 뺀다, #233)."""
    return [e for e in entries if e[0] in later and e[0] != client_id]
