"""한 프로세스 안의 장 방(Room). 같은 장에 붙은 연결들은 이 방 하나를 함께 쓴다.

- 문서(Doc)는 방마다 하나만 두고, 편집·커서는 Redis를 거치지 않고 메모리에서 바로 나눠 준다.
- 운영에서는 Caddy가 노트 경로로 프로세스를 골라 같은 장의 연결이 한 프로세스에 모인다.
  그래도 프로세스가 다시 뜨는 사이처럼 한 장이 여러 프로세스에 나뉠 수 있으므로, 같은 장을 연
  다른 프로세스(peer)가 있으면 채널 레이어로 편집·커서를 넘겨준다.
- 커서(awareness)는 방마다 잠깐(AWARENESS_EVERY) 모았다가 한 메시지로 보낸다.

프로세스 사이 메시지(채널 레이어, 장 그룹 page.<id>에는 프로세스 채널이 들어 있다)
- hub.hello: 이 장을 새로 열었다. 받은 쪽은 peer로 기억하고 hub.here로 문서·커서를 보내 준다.
- hub.here: 나도 이 장을 열고 있다(문서 전체·커서 포함).
- hub.update / hub.awareness: 편집 / 커서
- hub.bye: 이 장을 닫았다.
"""

import asyncio
import logging
import time
from typing import Awaitable, Callable, Protocol

from channels.db import database_sync_to_async
from channels.exceptions import ChannelFull
from channels.layers import get_channel_layer
from pycrdt import Doc, create_update_message, merge_updates

from . import awareness, boundary, memory, pages, presence_rules
from .presence_rules import Holder, Slot
from .models import Page

logger = logging.getLogger(__name__)

# 커서를 모아 보내는 간격(초). 방마다 초당 최대 20번만 보낸다.
AWARENESS_EVERY = 0.05
# 편집을 모았다가 저장하는 간격(초). 실시간 전달과 저장을 떼어 DB가 밀려도 전달이 멈추지 않게 한다.
FLUSH_EVERY = 0.3
# 채널 레이어 그룹은 하루가 지나면 만료되므로 방이 열려 있는 동안 가끔 다시 가입한다.
REGROUP_EVERY = 600
# 놓은 메모리를 운영체제에 돌려주는 주기(초). 방이 닫힐 때도 돌려준다(memory.py).
TRIM_EVERY = 300

EMPTY_UPDATE = b"\x00\x00"


def db(fn):
    """DB 작업을 스레드 풀에서 돌린다. 기본(thread_sensitive)은 모든 DB 작업이 스레드 하나에 줄을 선다.
    장 단위 행 잠금이 순서를 지킨다."""
    return database_sync_to_async(fn, thread_sensitive=False)


def page_group(page_id: int) -> str:
    return f"page.{page_id}"


class Member(Protocol):
    def push(self, data: bytes, volatile: bool = False) -> None:
        """보낼 메시지를 넘긴다(기다리지 않는다). volatile이면 밀려 있을 때 버려도 된다."""

    async def page_sealed(self, key: str | None, lost: int = 0) -> None:
        """장이 봉인돼 더 쓸 수 없다. key는 지금 쓰는 장(알면), lost는 옮기지 못해 버린 편집 수."""

    async def page_gone(self) -> None:
        """노트가 지워져 장이 없다."""


async def send_carried(layer, page_id: int, update: bytes) -> None:
    """다른 장에서 옮겨 와 이미 저장한 갱신을 그 장을 연 방(어느 프로세스든)에 넘긴다. 방은 문서에 합쳐 접속자에게 나눠 준다."""
    await layer.group_send(page_group(page_id), {"type": "hub.update", "page": page_id, "from": "carry", "update": update})


def _merge(updates: list[bytes]) -> bytes:
    return updates[0] if len(updates) == 1 else merge_updates(*updates)


def _runs(held: list[tuple[Member, bytes]]) -> list[tuple[Member, list[bytes]]]:
    """받은 차례대로, 같은 연결이 잇달아 보낸 편집끼리 묶는다."""
    runs: list[tuple[Member, list[bytes]]] = []
    for sender, update in held:
        if runs and runs[-1][0] is sender:
            runs[-1][1].append(update)
        else:
            runs.append((sender, [update]))
    return runs


class Room:
    def __init__(self, hub: "Hub", page_id: int) -> None:
        self.hub = hub
        self.page_id = page_id
        self.group = page_group(page_id)
        # pycrdt Doc은 만든 스레드에서만 쓴다. 방은 이벤트 루프 스레드에서만 다룬다.
        self.ydoc = Doc()
        self.members: set[Member] = set()
        self.loaded = asyncio.Event()
        # 이 장을 함께 연 다른 프로세스의 채널
        self.peers: set[str] = set()
        # 방에 알려진 커서: clientID -> (clock, state, 받은 시각)
        self.presence: dict[int, tuple[int, dict, float]] = {}
        # 이 프로세스에서 clientID를 쥔 연결과 그 사용자(#228·#230)
        self.holders: dict[int, Holder] = {}
        # clientID마다 방에 알려진 마지막 clock. 지운 뒤에도 남겨 다시 연결한 클라이언트의 clock을 그 뒤로 잇는다(#230).
        self.clocks: dict[int, int] = {}
        # 노트가 지워졌으면 저장·합치기를 하지 않는다
        self.gone = False
        # 아직 저장하지 않은 편집과 보낸 연결(장이 닫혀 버리면 버린 수를 그 연결에만 알린다, #278)
        self.pending: list[tuple[Member, bytes]] = []
        self.pending_at = None
        self.flusher: asyncio.Task | None = None
        # 저장은 방마다 하나씩만 돈다(#260). received는 이 방이 받은 편집 수, saved는 그중 앞에서부터 커밋된 수.
        self.saving = asyncio.Lock()
        self.received = 0
        self.saved = 0
        self.save_changed = asyncio.Condition()
        # 봉인돼 더 저장할 수 없다 / 마지막 연결이 나가 닫는 중이다
        self.sealed = False
        self.closed = False
        # 닫힌 장으로 온 편집의 장부(#268, boundary.LateEdits). 장부는 한 번에 하나만 쓴다.
        self.late: boundary.LateEdits | None = None
        self.late_lock = asyncio.Lock()
        # 아직 보내지 않은 커서
        self.aw_out: dict[int, tuple[int, dict | None]] = {}
        self.aw_task: asyncio.Task | None = None
        self.aw_last = 0.0
        self.regroup: asyncio.Task | None = None

    # ── 열기·닫기 ──────────────────────────────────────────────

    async def open(self, load: Callable[[], Awaitable[list[bytes]]]) -> None:
        # 그룹에 먼저 들어가 hello를 보낸 뒤 문서를 읽는다. 그 사이 다른 프로세스가 보낸 편집·문서는
        # 같은 Doc에 합쳐진다(중복 적용은 무해).
        await self.hub.layer.group_add(self.group, self.hub.channel)
        await self.hub.layer.group_send(self.group, {"type": "hub.hello", "page": self.page_id, "from": self.hub.channel})
        for update in await load():
            self.ydoc.apply_update(update)
        self.regroup = asyncio.create_task(self._regroup())
        self.loaded.set()

    async def _regroup(self) -> None:
        try:
            while True:
                await asyncio.sleep(REGROUP_EVERY)
                await self.hub.layer.group_add(self.group, self.hub.channel)
        except asyncio.CancelledError:
            pass

    async def close(self) -> None:
        """마지막 연결이 나갔다. 남은 커서·편집을 보내고 저장한 뒤 닫는다."""
        self.closed = True
        for task in (self.aw_task, self.flusher, self.regroup):
            if task:
                task.cancel()
        await self.flush_awareness()
        await self.flush()
        await self.hub.layer.group_discard(self.group, self.hub.channel)
        await self.to_peers({"type": "hub.bye"}, volatile=True)

    # ── 이 프로세스의 연결에서 온 것 ────────────────────────────

    async def local_update(self, sender: Member, update: bytes, received_at) -> None:
        self.ydoc.apply_update(update)
        message = create_update_message(update)
        for m in self.members:
            if m is not sender:
                m.push(message)
        await self.to_peers({"type": "hub.update", "update": update})
        self.pending.append((sender, update))
        self.pending_at = self.pending_at or received_at
        self.received += 1
        self._schedule_flush()

    async def local_awareness(self, sender: Member, entries: list[awareness.Entry]) -> None:
        now = time.monotonic()
        self._remember(entries, now)
        self.aw_out = presence_rules.batch(self.aw_out, entries)
        if self.aw_task and not self.aw_task.done():
            return
        wait = self.aw_last + AWARENESS_EVERY - now
        if wait <= 0:
            await self.flush_awareness()
        else:
            self.aw_task = asyncio.create_task(self._awareness_later(wait))

    async def _awareness_later(self, wait: float) -> None:
        await asyncio.sleep(wait)
        await self.flush_awareness()

    async def flush_awareness(self) -> None:
        if not self.aw_out:
            return
        entries = [(cid, clk, state) for cid, (clk, state) in self.aw_out.items()]
        self.aw_out = {}
        self.aw_last = time.monotonic()
        message = awareness.encode_message(entries)
        self._push_awareness(entries, message)
        await self.to_peers({"type": "hub.awareness", "message": message}, volatile=True)

    def _push_awareness(self, entries: list[awareness.Entry], message: bytes) -> None:
        """커서를 연결들에 보낸다. 누구에게 무엇을 보낼지는 presence_rules.deliveries가 정한다(#232)."""
        for m, rest in presence_rules.deliveries(entries, self.members, self.holders):
            m.push(message if rest is None else awareness.encode_message(rest), volatile=True)

    def presence_entries(self) -> list[awareness.Entry]:
        """방에 살아 있는 지금 커서들."""
        now = time.monotonic()
        return [(cid, clk, state) for cid, (clk, state, at) in self.presence.items() if presence_rules.alive(at, now)]

    def presence_message(self) -> bytes | None:
        """지금 커서들을 담은 메시지(다른 프로세스에 들어올 때 넘긴다)."""
        entries = self.presence_entries()
        return awareness.encode_message(entries) if entries else None

    def slot(self, client_id: int | None) -> Slot:
        """방이 아는 이 clientID: 쥔 연결, 커서가 살아 있는지, 마지막 clock(presence_rules가 판단한다)."""
        entry = self.presence.get(client_id)
        return Slot(
            holder=self.holders.get(client_id),
            alive=entry is not None and presence_rules.alive(entry[2], time.monotonic()),
            last_clock=self.clocks.get(client_id, -1),
        )

    def hold(self, member: Member, user_id: int, client_id: int) -> None:
        """사용자 user_id의 연결 member가 client_id의 커서를 쥔다(presence_rules가 쥘 수 있다고 정한 뒤)."""
        self.holders[client_id] = Holder(member, user_id)

    def claim(self, member: Member, user_id: int, client_id: int) -> bool:
        """쥘 수 있으면(presence_rules.can_claim) 쥐고 True."""
        if not presence_rules.can_claim(user_id, self.slot(client_id)):
            return False
        self.hold(member, user_id, client_id)
        return True

    def release(self, member: Member) -> None:
        """나가는 연결이 쥔 clientID를 놓는다."""
        for client_id in [cid for cid, holder in self.holders.items() if holder.conn is member]:
            del self.holders[client_id]

    def _remember(self, entries: list[awareness.Entry], now: float) -> None:
        for client_id, clk, state in entries:
            self.clocks[client_id] = max(clk, self.clocks.get(client_id, clk))
            if state is None:
                self.presence.pop(client_id, None)
            else:
                self.presence[client_id] = (clk, state, now)

    # ── 저장 ───────────────────────────────────────────────────

    def _schedule_flush(self) -> None:
        if self.flusher is None or self.flusher.done():
            self.flusher = asyncio.create_task(self._flush_later())

    async def _flush_later(self) -> None:
        """FLUSH_EVERY마다 쌓인 편집을 저장한다. 저장하는 동안 새로 쌓이거나 실패해 되돌아온 편집이 있으면 이어 간다.
        이 태스크가 취소돼도(방 닫기) 진행 중인 저장은 끝까지 간다."""
        while self.pending and not self.gone and not self.sealed:
            await asyncio.sleep(FLUSH_EVERY)
            await asyncio.shield(self.flush())

    async def flush(self) -> None:
        """모아 둔 편집을 하나로 합쳐 저장한다. 진행 중인 저장이 있으면 끝나기를 기다린 뒤 돈다.
        봉인됐거나 노트가 지워졌으면 연결들을 닫는다. 그 밖의 실패면 편집을 되돌려 놓아 다음 주기에 다시 저장한다."""
        async with self.saving:
            await self._save()

    async def _save(self) -> None:
        if not self.pending or self.gone or self.sealed:
            return
        held, received_at, through = self.pending, self.pending_at, self.received
        self.pending, self.pending_at = [], None
        merged = _merge([u for _, u in held])
        try:
            count = await db(pages.append_update)(self.page_id, merged, received_at)
        except pages.PageSealed:
            # 받은 시각에 장이 이미 닫혔다(#266, #268): 앞 장에는 넣지 않고 boundary가 정한 대로 지금 장으로 옮긴다.
            self.sealed = True
            await self._saved_changed()
            key, lost = await self._carry(held, received_at)
            # 버린 수는 그 편집을 보낸 연결에만 알린다(#278). 교체는 모두에게.
            for m in list(self.members):
                await m.page_sealed(key, lost.get(m, 0))
            return
        except Page.DoesNotExist:  # 그사이 노트가 지워졌다
            self.gone = True
            await self._saved_changed()
            for m in list(self.members):
                await m.page_gone()
            return
        except Exception:
            # 저장하지 못한 편집을 앞에 되돌려 놓는다. saved가 넘어가지 않으니 기다리던 확인도 나가지 않는다.
            self.pending = held + self.pending
            self.pending_at = received_at
            if self.closed:
                raise
            logger.exception("장 %s 편집 저장 실패, 다음 주기에 다시 저장한다", self.page_id)
            self._schedule_flush()
            return
        self.saved = through
        await self._saved_changed()
        if pages.should_compact(count):
            try:
                await db(pages.compact)(self.page_id)
            except Exception:  # 편집은 이미 저장됐다. 합치기는 다음 기회에 한다.
                logger.exception("장 %s 합치기 실패", self.page_id)

    async def _carry(self, held: list[tuple[Member, bytes]], received_at) -> tuple[str | None, dict[Member, int]]:
        """저장을 거절당한 편집을 지금 장으로 옮기고 (그 장의 키, 연결마다 버린 편집 수)를 돌려준다. 실패하면 키가 None
        (편집은 버린다). 받은 차례를 지키며 같은 연결이 잇달아 보낸 것끼리 묶어 옮긴다(앞 편집에 기대는 편집이 있다)."""
        key: str | None = None
        lost: dict[Member, int] = {}
        for sender, updates in _runs(held):
            try:
                carried = await self.carry_late(_merge(updates), received_at)
            except Exception:
                logger.exception("장 %s 봉인 뒤 편집을 새 장으로 옮기지 못했다", self.page_id)
                return None, {}
            if carried.page.id == self.page_id:
                return None, {}
            key = pages.page_key(carried.page.date, carried.page.seq)
            if carried.lost:
                lost[sender] = lost.get(sender, 0) + carried.lost
        return key, lost

    async def carry_late(self, update: bytes, received_at, base: bytes | None = None) -> pages.Carried:
        """닫힌 이 장으로 온 편집을 나눠 옮긴다(pages.carry_late). 옮긴 것은 지금 장을 연 방들에 넘긴다.
        base는 장부를 처음 만들 때 앞 장에 남는 내용(없으면 저장된 장 문서)."""
        async with self.late_lock:
            if self.late is None:
                self.late = boundary.LateEdits(base=base)
            carried = await db(pages.carry_late)(self.page_id, self.late, update, received_at)
        if carried.update is not None and carried.page.id != self.page_id:
            await send_carried(self.hub.layer, carried.page.id, carried.update)
        return carried

    async def _saved_changed(self) -> None:
        async with self.save_changed:
            self.save_changed.notify_all()

    async def saved_through(self, through: int) -> bool:
        """이 방이 받은 편집 through개가 모두 커밋되기를 기다린다. 확인(sync step2)은 이것이 참일 때만 나간다.
        강제로 저장하지 않고 예정된 주기 저장(또는 진행 중 저장)을 기다린다. 봉인·삭제로 더 저장할 수 없으면 False."""
        async with self.save_changed:
            await self.save_changed.wait_for(lambda: self.saved >= through or self.gone or self.sealed)
        return self.saved >= through

    # ── 다른 프로세스 ──────────────────────────────────────────

    async def to_peers(self, message: dict, volatile: bool = False) -> None:
        if not self.peers:
            return
        message = {**message, "page": self.page_id, "from": self.hub.channel}
        for peer in list(self.peers):
            try:
                await self.hub.layer.send(peer, message)
            except ChannelFull:
                if not volatile:
                    logger.warning("다른 프로세스(%s)가 밀려 장 %s 편집을 넘기지 못했다", peer, self.page_id)

    async def on_remote(self, event: dict) -> None:
        kind, sender = event["type"], event.get("from")
        if sender == self.hub.channel:
            return
        if kind == "hub.update":
            self.ydoc.apply_update(event["update"])
            message = create_update_message(event["update"])
            for m in self.members:
                m.push(message)
        elif kind == "hub.awareness":
            self._remote_awareness(event["message"])
        elif kind == "hub.hello":
            self.peers.add(sender)
            await self.hub.layer.send(
                sender,
                {
                    "type": "hub.here",
                    "page": self.page_id,
                    "from": self.hub.channel,
                    "state": self.ydoc.get_update(),
                    "presence": self.presence_message(),
                },
            )
        elif kind == "hub.here":
            self.peers.add(sender)
            before = self.ydoc.get_state()
            self.ydoc.apply_update(event["state"])
            diff = self.ydoc.get_update(before)
            if diff != EMPTY_UPDATE:
                message = create_update_message(diff)
                for m in self.members:
                    m.push(message)
            if event.get("presence"):
                self._remote_awareness(event["presence"])
        elif kind == "hub.bye":
            self.peers.discard(sender)

    def _remote_awareness(self, message: bytes) -> None:
        try:
            entries = awareness.decode_message(message)
        except Exception:
            logger.warning("잘못된 awareness 메시지", exc_info=True)
            return
        self._remember(entries, time.monotonic())
        self._push_awareness(entries, message)


class Hub:
    """프로세스(이벤트 루프)마다 하나. 열린 방들과, 다른 프로세스가 보내는 메시지를 받는 채널을 가진다."""

    def __init__(self) -> None:
        self.layer = get_channel_layer()
        self.loop = asyncio.get_running_loop()
        self.rooms: dict[int, Room] = {}
        # 닫는 중인 방. 저장이 끝나기 전에 같은 장을 새로 열어 DB를 읽지 않게 기다린다.
        self.closing: dict[int, asyncio.Event] = {}
        self.channel: str | None = None
        self.reader: asyncio.Task | None = None
        self.trimmer: asyncio.Task | None = None

    async def _start(self) -> None:
        if self.channel is None:
            # 연결(consumer) 채널과 같은 기본 앞부분으로 만든다. channels_redis는 프로세스마다 받기 잠금이 하나라,
            # 앞부분이 다르면 잠금을 쥔 쪽이 자기 앞부분 목록만 기다려 다른 쪽 메시지가 쌓인 채 읽히지 않았다
            # (운영에서 노트 색·종이 알림이 안 오고, 다른 프로세스 편집이 늦게 갈 수 있었다. tests/test_redis_layer.py).
            self.channel = await self.layer.new_channel()
            self.reader = asyncio.create_task(self._read())
            self.trimmer = asyncio.create_task(self._trim_forever())

    async def _trim_forever(self) -> None:
        """방이 닫히지 않아도(편집·다시 접속만 오가도) 놓은 메모리가 쌓이므로 주기적으로 돌려준다."""
        while True:
            await asyncio.sleep(TRIM_EVERY)
            memory.release()

    async def _read(self) -> None:
        while True:
            try:
                event = await self.layer.receive(self.channel)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("프로세스 채널 읽기 실패")
                await asyncio.sleep(1)
                continue
            await self._dispatch(event)
            # 다음 메시지를 기다리는 동안 이번 메시지를 붙잡지 않는다
            del event

    async def _dispatch(self, event: dict) -> None:
        """메시지 하나를 그 장의 방에 넘긴다. 방은 이 함수 안에서만 가리킨다: 루프의 지역 변수로 두면
        다음 메시지를 기다리는 동안 마지막에 다룬 방을 붙잡아, 닫힌 방의 문서(수 MB)가 풀리지 않았다."""
        room = self.rooms.get(event.get("page"))
        if room is None:
            return
        try:
            await room.on_remote(event)
        except Exception:
            logger.exception("다른 프로세스 메시지 처리 실패: %s", event.get("type"))

    async def join(self, page_id: int, member: Member, load: Callable[[], Awaitable[list[bytes]]]) -> Room:
        await self._start()
        while (closing := self.closing.get(page_id)) is not None:
            await closing.wait()
        room = self.rooms.get(page_id)
        if room is not None:
            room.members.add(member)
            await room.loaded.wait()
            return room
        room = Room(self, page_id)
        self.rooms[page_id] = room
        room.members.add(member)
        try:
            await room.open(load)
        except BaseException:
            self.rooms.pop(page_id, None)
            raise
        return room

    async def leave(self, room: Room, member: Member) -> bool:
        """방에서 나간다. 마지막 연결이었으면 방을 닫고 True."""
        room.members.discard(member)
        room.release(member)
        if room.members or self.rooms.get(room.page_id) is not room:
            return False
        del self.rooms[room.page_id]
        done = self.closing[room.page_id] = asyncio.Event()
        try:
            await room.close()
        finally:
            del self.closing[room.page_id]
            done.set()
        # 닫힌 방의 문서가 놓은 메모리를 운영체제에 돌려준다(memory.py)
        memory.release()
        return True


_hub: Hub | None = None


def hub() -> Hub:
    """지금 이벤트 루프의 Hub. 테스트처럼 루프가 바뀌면 새로 만든다."""
    global _hub
    if _hub is None or _hub.loop is not asyncio.get_running_loop():
        _hub = Hub()
    return _hub
