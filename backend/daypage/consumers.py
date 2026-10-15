"""장마다 웹소켓 방 하나. y-websocket 바이너리 프로토콜을 그대로 쓴다.

같은 장의 연결들은 프로세스 안의 방(hub.Room) 하나를 함께 쓴다. 문서·커서·저장은 방이 맡고,
연결(PageConsumer)은 인증·입장 판정과 주고받기만 한다.

닫는 코드
- 4401: 로그인하지 않았거나 노트 참여자가 아님
- 4404: 없는 노트이거나 잘못된 날짜
- 4409: 오늘 장이 아님(지난 장, 자정이 지남, 봉인됨). 클라이언트는 오늘 장으로 다시 접속한다.
- 4429: 노트의 동시 접속 상한을 넘음
- 1013: 보낼 편집이 너무 밀림. 클라이언트는 다시 접속해 문서를 처음부터 맞춘다.
"""

import asyncio
import datetime as dt
import json
import logging
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from pycrdt import (
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    handle_sync_message,
    read_message,
    write_message,
)

from . import awareness, clock, hub, pages, rooms
from .hub import EMPTY_UPDATE, db, page_group  # noqa: F401  page_group은 다른 모듈이 여기서 가져간다
from .models import Note, NoteMember

logger = logging.getLogger(__name__)

CLOSE_UNAUTHORIZED = 4401
CLOSE_NOT_FOUND = 4404
CLOSE_NOT_TODAY = 4409
CLOSE_CROWDED = 4429
CLOSE_TOO_SLOW = 1013

# y-websocket 메시지 종류 0(sync)·1(awareness) 외의 Daypage 전용 메시지.
# 텍스트 프레임은 y-websocket 클라이언트가 바이너리로 읽다 깨지므로 바이너리로 보낸다.
MESSAGE_PAGE_ROLLED = 100

# 연결마다 보내기를 기다릴 수 있는 메시지 수. 넘치면 커서는 버리고, 편집이 넘치면 연결을 끊는다.
OUTBOX_LIMIT = 512


def note_group(note_id: str) -> str:
    # 그룹 이름은 영문·숫자·-_. 만 쓸 수 있다. 노트 ID(urlsafe base64)는 그대로 쓸 수 있다.
    return f"note.{note_id}"


@database_sync_to_async
def _lookup(note_id: str, user) -> tuple[Note | None, NoteMember | None]:
    note = Note.objects.filter(pk=note_id).first()
    if not note:
        return None, None
    member = NoteMember.objects.filter(note=note, user=user).first() if user.is_authenticated else None
    return note, member


class PageConsumer(AsyncWebsocketConsumer):
    async def connect(self) -> None:
        self.page_id: int | None = None
        self.room: hub.Room | None = None
        self.conn: rooms.Conn | None = None
        self.heartbeat: asyncio.Task | None = None
        # 이 연결이 보낸 awareness 상태: clientID -> clock. 나갈 때 다른 사람 화면에서 지운다.
        self.presence: dict[int, int] = {}
        # 방이 넘겨준 메시지를 순서대로 보낸다. 느린 연결이 방 전체를 붙잡지 않게 연결마다 따로 보낸다.
        self.outbox: asyncio.Queue[bytes] = asyncio.Queue(OUTBOX_LIMIT)
        self.sender: asyncio.Task | None = None
        # 닫는 코드를 전하려면 먼저 수락해야 한다.
        await self.accept()

        kwargs = self.scope["url_route"]["kwargs"]
        self.note_id = kwargs["note_id"]
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            return await self.close(code=CLOSE_UNAUTHORIZED)
        try:
            date = dt.date.fromisoformat(kwargs["date"])
        except ValueError:
            return await self.close(code=CLOSE_NOT_FOUND)

        note, member = await _lookup(self.note_id, user)
        if note is None:
            return await self.close(code=CLOSE_NOT_FOUND)
        if member is None:
            return await self.close(code=CLOSE_UNAUTHORIZED)
        if date != clock.today_kst():
            return await self.close(code=CLOSE_NOT_TODAY)

        # 상한은 사람 수로 센다. 먼저 등록한 뒤 입장 순서로 판정해야 동시에 와도 상한을 넘지 않는다.
        # 이미 들어와 있는 사람의 새 탭·재연결은 그 사람의 첫 입장 순서를 따른다.
        registry = rooms.registry()
        conn = rooms.Conn(date.isoformat(), self.channel_name, user.id, time.time())
        await registry.add(self.note_id, conn)
        if not rooms.admitted(await registry.connections(self.note_id), user.id, settings.MAX_CONCURRENT_PER_NOTE):
            await registry.remove(self.note_id, conn)
            return await self.close(code=CLOSE_CROWDED)

        page = await db(pages.get_or_create_page)(note, date)
        self.page_id = page.id
        self.member = member
        self.date = date
        self.conn = conn

        # 노트 지움·자정 교체 알림은 노트 그룹으로 온다.
        await self.channel_layer.group_add(note_group(self.note_id), self.channel_name)
        self.sender = asyncio.create_task(self._send_loop())
        self.room = await hub.hub().join(page.id, self, lambda: db(pages.load_updates)(page.id))
        self.heartbeat = asyncio.create_task(self._heartbeat())
        await self.send(bytes_data=create_sync_message(self.room.ydoc))
        # 이미 있는 사람들의 커서를 보낸다.
        if (present := self.room.presence_message()) is not None:
            self.push(present, volatile=True)

    async def _heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(rooms.HEARTBEAT_EVERY)
                if self.conn:
                    await rooms.registry().touch(self.note_id, self.conn)
        except asyncio.CancelledError:
            pass

    # ── 방이 부르는 것(hub.Member) ──────────────────────────────

    def push(self, data: bytes, volatile: bool = False) -> None:
        if not self.outbox.full():
            self.outbox.put_nowait(data)
        elif not volatile:
            # 편집을 따라가지 못하는 연결은 끊는다. 다시 접속하면 문서 전체를 다시 맞춘다.
            logger.warning("보낼 편집이 밀려 연결을 끊는다(장 %s)", self.page_id)
            asyncio.create_task(self.close(code=CLOSE_TOO_SLOW))

    async def _send_loop(self) -> None:
        try:
            while True:
                data = await self.outbox.get()
                await self.send(bytes_data=data)
        except asyncio.CancelledError:
            pass
        except Exception:  # 이미 끊긴 연결
            pass

    async def page_sealed(self) -> None:
        await self.close(code=CLOSE_NOT_TODAY)

    async def page_gone(self) -> None:
        await self.close(code=CLOSE_NOT_FOUND)

    # ── 연결 종료 ──────────────────────────────────────────────

    async def disconnect(self, code) -> None:
        if self.heartbeat:
            self.heartbeat.cancel()
        if self.sender:
            self.sender.cancel()
        if self.room is None or self.conn is None:
            return
        room = self.room
        await self.channel_layer.group_discard(note_group(self.note_id), self.channel_name)
        # 이 연결이 보낸 커서를 다른 사람 화면에서 지운다.
        if self.presence:
            await room.local_awareness(self, [(cid, clk + 1, None) for cid, clk in self.presence.items()])
        closed = await hub.hub().leave(room, self)
        registry = rooms.registry()
        await registry.remove(self.note_id, self.conn)
        # 이 장에 아무도 남지 않았으면(다른 프로세스 포함) 스냅샷으로 합친다.
        remaining = [c for c in await registry.connections(self.note_id) if c.date == self.conn.date]
        if closed and not remaining and not room.gone:
            await db(pages.compact)(self.page_id)

    # ── 받기 ───────────────────────────────────────────────────

    async def receive(self, text_data=None, bytes_data=None) -> None:
        if not bytes_data or self.room is None:
            return
        kind = bytes_data[0]
        if kind == YMessageType.SYNC:
            await self._receive_sync(bytes_data)
        elif kind == YMessageType.AWARENESS:
            await self.receive_awareness(bytes_data)

    async def _receive_sync(self, data: bytes) -> None:
        sync_type = data[1]
        if sync_type == YSyncMessageType.SYNC_STEP1:
            # 동기화를 요청받으면 쌓아 둔 편집부터 저장한다(저장된 상태와 보내는 상태를 맞춘다).
            await self.room.flush()
            reply = handle_sync_message(data[1:], self.room.ydoc)
            if reply is not None:
                await self.send(bytes_data=reply)
            return
        update = read_message(data[2:])
        if not update or update == EMPTY_UPDATE:
            return
        # 자정 경계는 받은 시각으로 바로 판정한다(DB를 기다리지 않는다).
        received_at = clock.now()
        if clock.kst_date_of(received_at) != self.date:
            await self.close(code=CLOSE_NOT_TODAY)
            return
        await self.room.local_update(self, update, received_at)

    async def receive_awareness(self, data: bytes) -> None:
        """닉네임·색은 클라이언트가 보낸 값 대신 서버가 배정한 값으로 바꿔 퍼뜨린다."""
        try:
            entries = awareness.decode_message(data)
        except Exception:
            logger.warning("잘못된 awareness 메시지", exc_info=True)
            return
        cleaned: list[awareness.Entry] = []
        for client_id, clk, state in entries:
            if state is None:
                self.presence.pop(client_id, None)
                cleaned.append((client_id, clk, None))
                continue
            state = {
                "cursor": state.get("cursor"),
                "editingBoxId": state.get("editingBoxId"),
                "nickname": self.member.nickname,
                "color": self.member.color,
            }
            self.presence[client_id] = clk
            cleaned.append((client_id, clk, state))
        await self.room.local_awareness(self, cleaned)

    # ── 노트 그룹 알림 ─────────────────────────────────────────

    async def page_rolled(self, event) -> None:
        """자정 교체: 새 장 날짜를 알리고 이 방을 닫는다. 클라이언트는 새 날짜 방으로 옮겨 간다."""
        if event["date"] == self.date.isoformat():
            return
        payload = json.dumps({"type": "page_rolled", "date": event["date"]}, separators=(",", ":")).encode()
        await self.send(bytes_data=bytes([MESSAGE_PAGE_ROLLED]) + write_message(payload))
        await self.close(code=CLOSE_NOT_TODAY)

    async def note_deleted(self, event) -> None:
        """만든 사람이 노트를 지웠다. 장도 함께 사라졌으니 저장·합치기를 하지 않고 닫는다."""
        if self.room is not None:
            self.room.gone = True
        await self.close(code=CLOSE_NOT_FOUND)
