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

from . import awareness, memory, pages
from .models import Page

logger = logging.getLogger(__name__)

# 커서를 모아 보내는 간격(초). 방마다 초당 최대 20번만 보낸다.
AWARENESS_EVERY = 0.05
# 편집을 모았다가 저장하는 간격(초). 실시간 전달과 저장을 떼어 DB가 밀려도 전달이 멈추지 않게 한다.
FLUSH_EVERY = 0.3
# 이 시간 동안 갱신되지 않은 커서는 새로 온 사람에게 보내지 않는다. 클라이언트는 15초마다 갱신한다.
PRESENCE_TTL = 35
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

    async def page_sealed(self) -> None:
        """장이 봉인돼 더 쓸 수 없다."""

    async def page_gone(self) -> None:
        """노트가 지워져 장이 없다."""


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
        # 노트가 지워졌으면 저장·합치기를 하지 않는다
        self.gone = False
        # 아직 저장하지 않은 편집
        self.pending: list[bytes] = []
        self.pending_at = None
        self.flusher: asyncio.Task | None = None
        # 아직 보내지 않은 커서
        self.aw_out: dict[int, tuple[int, dict | None]] = {}
        self.aw_from: set[Member] = set()
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
        self.pending.append(update)
        self.pending_at = self.pending_at or received_at
        if self.flusher is None or self.flusher.done():
            self.flusher = asyncio.create_task(self._flush_later())

    async def local_awareness(self, sender: Member, entries: list[awareness.Entry]) -> None:
        now = time.monotonic()
        self._remember(entries, now)
        for client_id, clk, state in entries:
            prev = self.aw_out.get(client_id)
            if prev is None or clk >= prev[0]:
                self.aw_out[client_id] = (clk, state)
        self.aw_from.add(sender)
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
        senders = self.aw_from
        self.aw_out, self.aw_from = {}, set()
        self.aw_last = time.monotonic()
        message = awareness.encode_message(entries)
        for m in self.members:
            # 자기 커서만 든 메시지는 돌려보내지 않는다(자기 것이 섞여 있어도 클라이언트는 무시한다).
            if senders != {m}:
                m.push(message, volatile=True)
        await self.to_peers({"type": "hub.awareness", "message": message}, volatile=True)

    def presence_message(self) -> bytes | None:
        """새로 온 사람에게 보낼 지금 커서들."""
        now = time.monotonic()
        entries = [(cid, clk, state) for cid, (clk, state, at) in self.presence.items() if now - at < PRESENCE_TTL]
        return awareness.encode_message(entries) if entries else None

    def _remember(self, entries: list[awareness.Entry], now: float) -> None:
        for client_id, clk, state in entries:
            if state is None:
                self.presence.pop(client_id, None)
            else:
                self.presence[client_id] = (clk, state, now)

    # ── 저장 ───────────────────────────────────────────────────

    async def _flush_later(self) -> None:
        await asyncio.sleep(FLUSH_EVERY)
        await self.flush()

    async def flush(self) -> None:
        """모아 둔 편집을 하나로 합쳐 저장한다. 봉인됐거나 노트가 지워졌으면 연결들을 닫는다."""
        if not self.pending or self.gone:
            return
        updates, received_at = self.pending, self.pending_at
        self.pending, self.pending_at = [], None
        merged = updates[0] if len(updates) == 1 else merge_updates(*updates)
        try:
            count = await db(pages.append_update)(self.page_id, merged, received_at)
        except pages.PageSealed:
            for m in list(self.members):
                await m.page_sealed()
            return
        except Page.DoesNotExist:  # 그사이 노트가 지워졌다
            self.gone = True
            for m in list(self.members):
                await m.page_gone()
            return
        if pages.should_compact(count):
            await db(pages.compact)(self.page_id)

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
            self._remember(awareness.decode_message(message), time.monotonic())
        except Exception:
            logger.warning("잘못된 awareness 메시지", exc_info=True)
            return
        for m in self.members:
            m.push(message, volatile=True)


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
