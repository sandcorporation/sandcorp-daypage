"""장마다 웹소켓 방 하나. y-websocket 바이너리 프로토콜을 그대로 쓴다.

닫는 코드
- 4401: 로그인하지 않았거나 노트 참여자가 아님
- 4404: 없는 노트이거나 잘못된 날짜
- 4409: 오늘 장이 아님(지난 장, 자정이 지남, 봉인됨). 클라이언트는 오늘 장으로 다시 접속한다.
- 4429: 노트의 동시 접속 상한을 넘음
"""

import asyncio
import datetime as dt
import json
import time
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from pycrdt import (
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
    write_message,
)

from . import awareness, clock, pages, rooms
from .models import Note, NoteMember, Page

logger = logging.getLogger(__name__)

CLOSE_UNAUTHORIZED = 4401
CLOSE_NOT_FOUND = 4404
CLOSE_NOT_TODAY = 4409
CLOSE_CROWDED = 4429

EMPTY_UPDATE = b"\x00\x00"

# y-websocket 메시지 종류 0(sync)·1(awareness) 외의 Daypage 전용 메시지.
# 텍스트 프레임은 y-websocket 클라이언트가 바이너리로 읽다 깨지므로 바이너리로 보낸다.
MESSAGE_PAGE_ROLLED = 100


def page_group(page_id: int) -> str:
    return f"page.{page_id}"


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
        self.conn: rooms.Conn | None = None
        self.heartbeat: asyncio.Task | None = None
        # 이 연결이 보낸 awareness 상태: clientID -> (clock, state)
        self.presence: dict[int, tuple[int, dict]] = {}
        self.note_gone = False
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

        page = await database_sync_to_async(pages.get_or_create_page)(note, date)
        self.page_id = page.id
        self.member = member
        self.date = date
        self.conn = conn

        # 그룹에 먼저 들어간 뒤 문서를 읽어, 그 사이의 변경을 놓치지 않는다(중복 적용은 무해).
        await self.channel_layer.group_add(page_group(page.id), self.channel_name)
        await self.channel_layer.group_add(note_group(self.note_id), self.channel_name)
        # pycrdt Doc은 만든 스레드에서만 쓸 수 있으므로 DB에서는 바이트만 읽고 여기서 만든다.
        self.ydoc = pages.build_doc(await database_sync_to_async(pages.load_updates)(page.id))
        self.heartbeat = asyncio.create_task(self._heartbeat())
        await self.send(bytes_data=create_sync_message(self.ydoc))
        await self.on_joined()

    async def on_joined(self) -> None:
        # 이미 있는 사람들의 Presence를 새로 온 사람에게 보내 달라고 요청한다.
        await self.channel_layer.group_send(
            page_group(self.page_id), {"type": "awareness.query", "reply_to": self.channel_name}
        )

    async def _heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(rooms.HEARTBEAT_EVERY)
                if self.conn:
                    await rooms.registry().touch(self.note_id, self.conn)
        except asyncio.CancelledError:
            pass

    async def disconnect(self, code) -> None:
        if self.heartbeat:
            self.heartbeat.cancel()
        if self.page_id is None or self.conn is None:
            return
        await self.channel_layer.group_discard(page_group(self.page_id), self.channel_name)
        await self.channel_layer.group_discard(note_group(self.note_id), self.channel_name)
        registry = rooms.registry()
        await registry.remove(self.note_id, self.conn)
        await self.on_left()
        remaining = [c for c in await registry.connections(self.note_id) if c.date == self.conn.date]
        if not remaining and not self.note_gone:
            await database_sync_to_async(pages.compact)(self.page_id)

    async def on_left(self) -> None:
        # 이 연결이 보낸 Presence를 다른 사람 화면에서 지운다.
        if self.presence:
            gone = [(cid, clk + 1, None) for cid, (clk, _) in self.presence.items()]
            await self.channel_layer.group_send(
                page_group(self.page_id),
                {"type": "y.awareness", "message": awareness.encode_message(gone), "sender": self.channel_name},
            )

    async def receive(self, text_data=None, bytes_data=None) -> None:
        if not bytes_data or self.page_id is None:
            return
        kind = bytes_data[0]
        if kind == YMessageType.SYNC:
            await self._receive_sync(bytes_data)
        elif kind == YMessageType.AWARENESS:
            await self.receive_awareness(bytes_data)

    async def _receive_sync(self, data: bytes) -> None:
        sync_type = data[1]
        if sync_type == YSyncMessageType.SYNC_STEP1:
            reply = handle_sync_message(data[1:], self.ydoc)
            if reply is not None:
                await self.send(bytes_data=reply)
            return
        update = read_message(data[2:])
        if not update or update == EMPTY_UPDATE:
            return
        try:
            pending = await database_sync_to_async(pages.append_update)(self.page_id, update, clock.now())
        except pages.PageSealed:
            await self.close(code=CLOSE_NOT_TODAY)
            return
        except Page.DoesNotExist:  # 그사이 노트가 지워졌다
            await self.close(code=CLOSE_NOT_FOUND)
            return
        self.ydoc.apply_update(update)
        await self.channel_layer.group_send(
            page_group(self.page_id), {"type": "y.update", "update": update, "sender": self.channel_name}
        )
        if pages.should_compact(pending):
            await database_sync_to_async(pages.compact)(self.page_id)

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
            self.presence[client_id] = (clk, state)
            cleaned.append((client_id, clk, state))
        await self.channel_layer.group_send(
            page_group(self.page_id),
            {"type": "y.awareness", "message": awareness.encode_message(cleaned), "sender": self.channel_name},
        )

    async def awareness_query(self, event) -> None:
        if event["reply_to"] == self.channel_name or not self.presence:
            return
        entries = [(cid, clk, state) for cid, (clk, state) in self.presence.items()]
        await self.channel_layer.send(
            event["reply_to"],
            {"type": "y.awareness", "message": awareness.encode_message(entries), "sender": self.channel_name},
        )

    async def y_update(self, event) -> None:
        if event["sender"] == self.channel_name:
            return
        self.ydoc.apply_update(event["update"])
        await self.send(bytes_data=create_update_message(event["update"]))

    async def y_awareness(self, event) -> None:
        if event["sender"] == self.channel_name:
            return
        await self.send(bytes_data=event["message"])

    async def page_rolled(self, event) -> None:
        """자정 교체: 새 장 날짜를 알리고 이 방을 닫는다. 클라이언트는 새 날짜 방으로 옮겨 간다."""
        if event["date"] == self.date.isoformat():
            return
        payload = json.dumps({"type": "page_rolled", "date": event["date"]}, separators=(",", ":")).encode()
        await self.send(bytes_data=bytes([MESSAGE_PAGE_ROLLED]) + write_message(payload))
        await self.close(code=CLOSE_NOT_TODAY)

    async def note_deleted(self, event) -> None:
        """만든 사람이 노트를 지웠다. 장도 함께 사라졌으니 스냅샷은 합치지 않고 닫는다."""
        self.note_gone = True
        await self.close(code=CLOSE_NOT_FOUND)
