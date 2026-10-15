"""장마다 웹소켓 방 하나. y-websocket 바이너리 프로토콜을 그대로 쓴다.

닫는 코드
- 4401: 로그인하지 않았거나 노트 참여자가 아님
- 4404: 없는 노트이거나 잘못된 날짜
- 4409: 오늘 장이 아님(지난 장, 자정이 지남, 봉인됨). 클라이언트는 오늘 장으로 다시 접속한다.
- 4429: 노트의 동시 접속 상한을 넘음
"""

import asyncio
import datetime as dt
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
)

from . import clock, pages, rooms
from .models import Note, NoteMember

logger = logging.getLogger(__name__)

CLOSE_UNAUTHORIZED = 4401
CLOSE_NOT_FOUND = 4404
CLOSE_NOT_TODAY = 4409
CLOSE_CROWDED = 4429

EMPTY_UPDATE = b"\x00\x00"


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

        registry = rooms.registry()
        if len(await registry.connections(self.note_id)) >= settings.MAX_CONCURRENT_PER_NOTE:
            return await self.close(code=CLOSE_CROWDED)

        page = await database_sync_to_async(pages.get_or_create_page)(note, date)
        self.page_id = page.id
        self.member = member
        self.date = date
        self.conn = rooms.Conn(date.isoformat(), self.channel_name, user.id)

        # 그룹에 먼저 들어간 뒤 문서를 읽어, 그 사이의 변경을 놓치지 않는다(중복 적용은 무해).
        await self.channel_layer.group_add(page_group(page.id), self.channel_name)
        await self.channel_layer.group_add(note_group(self.note_id), self.channel_name)
        await registry.add(self.note_id, self.conn)
        # pycrdt Doc은 만든 스레드에서만 쓸 수 있으므로 DB에서는 바이트만 읽고 여기서 만든다.
        self.ydoc = pages.build_doc(await database_sync_to_async(pages.load_updates)(page.id))
        self.heartbeat = asyncio.create_task(self._heartbeat())
        await self.send(bytes_data=create_sync_message(self.ydoc))
        await self.on_joined()

    async def on_joined(self) -> None:
        """하위 클래스·Presence가 접속 직후 할 일."""

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
        if not remaining:
            await database_sync_to_async(pages.compact)(self.page_id)

    async def on_left(self) -> None:
        """하위 클래스·Presence가 나갈 때 할 일."""

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
        self.ydoc.apply_update(update)
        await self.channel_layer.group_send(
            page_group(self.page_id), {"type": "y.update", "update": update, "sender": self.channel_name}
        )
        if pages.should_compact(pending):
            await database_sync_to_async(pages.compact)(self.page_id)

    async def receive_awareness(self, data: bytes) -> None:
        await self.channel_layer.group_send(
            page_group(self.page_id), {"type": "y.awareness", "message": data, "sender": self.channel_name}
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
