"""장마다 웹소켓 방 하나. y-websocket 바이너리 프로토콜을 그대로 쓴다.

같은 장의 연결들은 프로세스 안의 방(hub.Room) 하나를 함께 쓴다. 문서·커서·저장은 방이 맡고,
연결(PageConsumer)은 인증·입장 판정과 주고받기만 한다.

닫는 코드
- 4401: 로그인하지 않았거나 노트 참여자가 아님
- 4404: 없는 노트이거나 잘못된 날짜
- 4409: 오늘 장이 아님(지난 장, 자정이 지남, 봉인됨). 클라이언트는 오늘 장으로 다시 접속한다.
- 4429: 노트의 동시 접속 상한을 넘음
- 4430: 서비스 수용 인원이 찼고 대기열도 가득 참
- 4408: 대기자에게 자리를 돌리려고 자리 비움인 사람을 내보냄. 클라이언트는 자동으로 다시 접속하지 않는다.
- 1013: 보낼 편집이 너무 밀림. 클라이언트는 다시 접속해 문서를 처음부터 맞춘다.
- 4403: 운영자가 정지한 사용자(moderation.py). 다시 접속하지 않는다.
- 4410: 운영자가 닫은 노트. 다시 접속하지 않는다.
- 4411: 노트를 만든 사람이 내보낸 참여자. 다시 접속하지 않는다.

수용 인원이 차면 연결을 연 채 대기열에 세운다(admission.py). 대기자는 문서·커서 대신 메시지 101(queued)을
받다가, 차례가 오면 같은 연결에서 평소 입장(방 참가, sync step1)이 이어진다.
"""

import asyncio
import datetime as dt
import json
import logging
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from uvicorn.protocols.utils import ClientDisconnected
from django.conf import settings
from pycrdt import (
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    handle_sync_message,
    read_message,
    write_message,
)

from . import admission, awareness, boundary, clock, hub, membership, moderation, pages, presence_rules, rooms
from .hub import EMPTY_UPDATE, db, page_group  # noqa: F401  page_group은 다른 모듈이 여기서 가져간다
from .models import Note, NoteMember, Page, User

logger = logging.getLogger(__name__)

CLOSE_UNAUTHORIZED = 4401
CLOSE_NOT_FOUND = 4404
CLOSE_NOT_TODAY = 4409
CLOSE_CROWDED = 4429
CLOSE_FULL = 4430
CLOSE_AWAY = 4408
CLOSE_TOO_SLOW = 1013
CLOSE_SUSPENDED = 4403
CLOSE_CLOSED = 4410
CLOSE_KICKED = 4411

# y-websocket 메시지 종류 0(sync)·1(awareness) 외의 Daypage 전용 메시지.
# 텍스트 프레임은 y-websocket 클라이언트가 바이너리로 읽다 깨지므로 바이너리로 보낸다.
MESSAGE_PAGE_ROLLED = 100
MESSAGE_QUEUED = 101
# 노트 색이 바뀜: {"type":"note_colors","colors":[...]}
MESSAGE_NOTE_COLORS = 102
# 노트 종이가 바뀜: {"type":"note_paper","paper":{pattern, margin, color}}
MESSAGE_NOTE_PAPER = 103
# 장의 봉인 예정 시각이 바뀜(주인이 봉인 시각을 바꿈): {"type":"note_page","key","dueAt","sealHour"}
MESSAGE_NOTE_PAGE = 104
# 노트 머리말이 바뀜(이름 변경·새 참여·내보내기·다시 허용·정원 변경): {"type":"note_info","name","memberCount","memberLimit","seq"}
# 노트 그룹에 든 뒤에도 그때의 머리말을 한 번 보낸다(그룹에 들기 전에 나간 알림을 놓치지 않게, #222).
# seq는 읽은 순서대로 커지는 판이다. 화면은 받은 것보다 작은 판을 버린다(membership.current_info).
MESSAGE_NOTE_INFO = 105
# 장이 바뀌는 순간 보낸 편집 중 옮기지 못해 버린 것이 있다(#268): {"type":"edits_lost","count"}. 그 편집을 보낸 연결에만
# 보낸다(#278). 교체 알림보다 먼저, 또는 교체 뒤 옛 연결을 닫기 전에(클라이언트는 서버가 닫을 때까지 받는다).
MESSAGE_EDITS_LOST = 106

# 열린 연결의 권한(내보냄·정지·노트 닫힘)을 이만큼 지나면 다시 본다. 끊는 것은 보통 알림이 하지만 알림이 실패하면
# (broadcast.py, 다시 보내지 않음) 끊을 길이 없다(#256). 메시지마다 DB를 치지 않고 시계만 비교한다.
RECHECK_AFTER = dt.timedelta(seconds=15)

# 대기 중에 받아 두었다가 입장하면 다시 처리할 메시지 수(클라이언트가 연결하자마자 보내는 sync step1·커서)
HELD_LIMIT = 16


def daypage_message(kind: int, payload: dict) -> bytes:
    return bytes([kind]) + write_message(json.dumps(payload, separators=(",", ":")).encode())

# 연결마다 보내기를 기다릴 수 있는 메시지 수. 넘치면 커서는 버리고, 편집이 넘치면 연결을 끊는다.
OUTBOX_LIMIT = 512

# 이만큼(초) 보낼 것이 없으면 빈 awareness를 보낸다. y-websocket 클라이언트는 30초 동안 아무것도 받지 못하면
# 연결이 죽었다고 보고 끊었다 다시 붙는다(혼자 있는 노트에서 33초마다 다시 접속하던 원인).
KEEPALIVE_EVERY = 10
# 빈 awareness: 아무의 커서도 바꾸지 않는다.
KEEPALIVE = awareness.encode_message([])


def note_info_message(info: dict) -> bytes:
    payload = {k: info[k] for k in ("name", "memberCount", "memberLimit", "seq")}
    return daypage_message(MESSAGE_NOTE_INFO, {"type": "note_info", **payload})


def note_group(note_id: str) -> str:
    # 그룹 이름은 영문·숫자·-_. 만 쓸 수 있다. 노트 ID(urlsafe base64)는 그대로 쓸 수 있다.
    return f"note.{note_id}"


def _block_code(note: Note, user) -> int | None:
    """운영 조치로 들어올 수 없으면 닫는 코드(moderation.py)."""
    try:
        moderation.check_note(note, user)
    except moderation.NoteClosed:
        return CLOSE_CLOSED
    except moderation.Suspended:
        return CLOSE_SUSPENDED
    except moderation.Kicked:
        return CLOSE_KICKED
    return None


_blocked_code = database_sync_to_async(_block_code)


@database_sync_to_async
def _lookup(note_id: str, user) -> tuple[Note | None, NoteMember | None]:
    note = Note.objects.filter(pk=note_id).first()
    if not note:
        return None, None
    member = NoteMember.objects.filter(note=note, user=user).first() if user.is_authenticated else None
    return note, member


@database_sync_to_async
def _recheck(note_id: str, user_id: int) -> tuple[int | None, NoteMember | None]:
    """들어가기 직전에 다시 본다: 들어갈 수 없으면 (닫는 코드, None), 들어가도 되면 (None, 지금 멤버십).
    사용자도 DB에서 새로 읽는다(연결의 사용자 객체는 접속할 때의 정지 상태를 들고 있다)."""
    note = Note.objects.filter(pk=note_id).first()
    user = User.objects.filter(pk=user_id).first()
    if note is None or user is None:
        return CLOSE_NOT_FOUND, None
    if (code := _block_code(note, user)) is not None:
        return code, None
    member = NoteMember.objects.filter(note=note, user=user).first()
    if member is None:
        return CLOSE_UNAUTHORIZED, None
    return None, member


class PageConsumer(AsyncWebsocketConsumer):
    async def connect(self) -> None:
        self.page_id: int | None = None
        self.room: hub.Room | None = None
        self.conn: rooms.Conn | None = None
        self.heartbeat: asyncio.Task | None = None
        # 이 연결의 awareness clientID와 마지막 clock. 나갈 때 이것만 다른 사람 화면에서 지운다(#228).
        self.client_id: int | None = None
        self.client_clock: int | None = None
        # 이 연결이 받은 clock에 더해 퍼뜨리는 값. 다시 연결한 클라이언트는 provider를 새로 만들어 clock을 처음부터
        # 세는데, 남의 화면은 옛 clock보다 작은 것을 버린다. 방이 본 마지막 clock 뒤로 잇는다(#230).
        self.clock_shift = 0
        # 들어올 때 미뤄 둔 지금 커서의 clientID. 이 연결의 clientID가 정해지면 그것만 빼고 보낸다(#233, presence_rules).
        self.presence_later: set[int] | None = None
        # 방이 넘겨준 메시지를 순서대로 보낸다. 느린 연결이 방 전체를 붙잡지 않게 연결마다 따로 보낸다.
        self.outbox: asyncio.Queue[bytes] = asyncio.Queue(OUTBOX_LIMIT)
        self.sender: asyncio.Task | None = None
        # sync step1에 답하는 태스크(마지막 것). 답은 받은 차례대로, 앞서 받은 편집이 커밋된 뒤에 나간다(#260).
        self.answering: asyncio.Task | None = None
        # 수용 인원: 대기열 항목, 대기 태스크, 대기 중 받아 둔 메시지, 서비스 접속 목록에 올렸는지
        self.waiter: admission.Waiter | None = None
        self.waiting: asyncio.Task | None = None
        self.entering = False
        self.held: list[bytes] = []
        self.online = False
        # 자리 비움: 마지막 입력(편집·커서 변경) 시각과 저장소에 마지막으로 올린 시각
        self.last_input = 0.0
        self.input_reported = 0.0
        self.cursor_state: tuple | None = None
        # 닫기 시작했거나 보내다 끊긴 걸 안 연결. 더 보내지 않고 다시 닫지 않는다.
        self.closing = False
        # 장이 바뀌었다고 이 연결에 알렸는지, 알린 뒤 늦게 닫는 태스크(#266)
        self.rolled = False
        self.roll_closer: asyncio.Task | None = None
        # 마지막으로 권한을 본 시각(clock.now), 다시 보다 막혀 닫은 코드, 같은 때 두 번 묻지 않게 하는 자물쇠(#256)
        self.checked_at: dt.datetime | None = None
        self.revoked: int | None = None
        self.recheck_lock = asyncio.Lock()
        # 닫는 코드를 전하려면 먼저 수락해야 한다.
        await self.accept()

        kwargs = self.scope["url_route"]["kwargs"]
        self.note_id = kwargs["note_id"]
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            return await self.close(code=CLOSE_UNAUTHORIZED)
        key = kwargs["key"]
        try:
            pages.parse_key(key)
        except ValueError:
            return await self.close(code=CLOSE_NOT_FOUND)

        note, member = await _lookup(self.note_id, user)
        if note is None:
            return await self.close(code=CLOSE_NOT_FOUND)
        blocked = await _blocked_code(note, user)
        if blocked is not None:
            return await self.close(code=blocked)
        if member is None:
            return await self.close(code=CLOSE_UNAUTHORIZED)
        # 지금 쓰는 장만 받는다(지난 장·아직 안 열린 장은 거절)
        if key != await db(pages.current_key)(note):
            return await self.close(code=CLOSE_NOT_TODAY)

        # 상한은 사람 수로 센다. 먼저 등록한 뒤 입장 순서로 판정해야 동시에 와도 상한을 넘지 않는다.
        # 이미 들어와 있는 사람의 새 탭·재연결은 그 사람의 첫 입장 순서를 따른다.
        registry = rooms.registry()
        conn = rooms.Conn(key, self.channel_name, user.id, time.time())
        await registry.add(self.note_id, conn)
        if not rooms.admitted(await registry.connections(self.note_id), user.id, settings.MAX_CONCURRENT_PER_NOTE):
            await registry.remove(self.note_id, conn)
            return await self.close(code=CLOSE_CROWDED)

        self.note = note
        self.member = member
        self.key = key
        # 장의 봉인 예정 시각. 쓰기는 이 전까지만 받는다(주인이 봉인 시각을 바꾸면 note.page 알림으로 갱신).
        self.due_at: dt.datetime | None = None
        self.conn = conn
        self.heartbeat = asyncio.create_task(self._heartbeat())

        # 수용 인원: 먼저 대기열에 선 뒤 판정한다. 비어 있고 자리가 있으면 바로 들어간다.
        await admission.publish_share()
        store = admission.store()
        self.waiter = admission.Waiter(user.id, time.time(), self.channel_name)
        await store.wait_add(self.waiter)
        decision = admission.decide(await store.snapshot(), self.waiter)
        if decision.full:
            await store.wait_remove(self.waiter)
            await registry.remove(self.note_id, conn)
            self.waiter = self.conn = None
            return await self.close(code=CLOSE_FULL)
        if decision.admit:
            return await self._enter()
        # 기다리는 동안은 노트 접속자로 치지 않는다(접속자 수·마지막 사람이 나갈 때의 합치기). 들어갈 때 다시 등록한다.
        await registry.remove(self.note_id, conn)
        self.conn = None
        await self._send_position(decision.position)
        self.waiting = asyncio.create_task(self._wait())

    async def _enter(self) -> None:
        """서비스 접속 목록에 올리고 장 방에 들어간다."""
        self.entering = True
        store = admission.store()
        if self.conn is None:
            # 대기열에서 오는 길: 노트별 상한을 다시 판정한다(기다리는 사이 노트가 찼을 수 있다).
            registry = rooms.registry()
            conn = rooms.Conn(self.key, self.channel_name, self.waiter.user_id, time.time())
            await registry.add(self.note_id, conn)
            if not rooms.admitted(
                await registry.connections(self.note_id), conn.user_id, settings.MAX_CONCURRENT_PER_NOTE
            ):
                await registry.remove(self.note_id, conn)
                await store.wait_remove(self.waiter)
                self.waiter = None
                self.entering = False
                return await self.close(code=CLOSE_CROWDED)
            self.conn = conn
        # 접속 목록에 먼저 올린 뒤 줄에서 빠진다. 그 사이 판정하는 다른 대기자는 자리를 더 적게 본다(넘치지 않는다).
        await store.online_add(self.conn)
        self.online = True
        self.last_input = self.input_reported = time.time()
        await store.report_input(self.channel_name, self.last_input)
        await store.wait_remove(self.waiter)
        self.waiter = None
        # 노트 지움·닫힘·자정 교체 알림은 노트 그룹으로 온다.
        await self.channel_layer.group_add(note_group(self.note_id), self.channel_name)
        # 정지·내보내기는 사용자에게 알린다(그 사람의 모든 연결을 끊는다)
        await self.channel_layer.group_add(moderation.user_group(self.member.user_id), self.channel_name)
        # 내보냄·정지·노트 닫힘·지움은 접속할 때 한 번 봤지만, 대기열에서 기다리는 동안은 그룹 밖이라 알림을 못 받는다.
        # 그룹에 든 뒤 다시 읽어야 그 사이 조치가 이 재검사나 알림 둘 중 하나로 반드시 잡힌다(#224).
        code, member = await _recheck(self.note_id, self.member.user_id)
        if code is None:
            page = await db(pages.open_page)(self.note)
            if pages.page_key(page.date, page.seq) != self.key:  # 기다리는 사이 장이 바뀌었다
                code = CLOSE_NOT_TODAY
        if code is not None:
            await self.channel_layer.group_discard(note_group(self.note_id), self.channel_name)
            await self.channel_layer.group_discard(moderation.user_group(self.member.user_id), self.channel_name)
            self.entering = False
            return await self.close(code=code)
        self.checked_at = clock.now()
        self.page_id = page.id
        self.due_at = page.due_at
        self.member = member  # 기다리는 사이 바뀐 닉네임·색을 따른다
        # 그룹에 든 뒤 지금 머리말을 보낸다. 그룹에 들기 전에 바뀐 것도 여기서 따라잡는다.
        if (info := await database_sync_to_async(membership.current_info)(self.note_id)) is not None:
            await self.send(bytes_data=note_info_message(info))
        self.sender = asyncio.create_task(self._send_loop())
        self.room = await hub.hub().join(page.id, self, lambda: db(pages.load_updates)(page.id))
        # 들어오는 사이 클라이언트가 떠났어도 send는 조용히 끝난다. 방에서 나가는 건 disconnect가 한다.
        await self.send(bytes_data=create_sync_message(self.room.ydoc))
        # 이미 있는 사람들의 커서를 보낸다. 자기 것일 수 있는 것은 clientID가 정해진 뒤로 미룬다(#233).
        now, self.presence_later = presence_rules.arrival(
            self.room.presence_entries(), self.member.user_id, self.room.holders
        )
        if now:
            self.push(awareness.encode_message(now), volatile=True)
        self.entering = False
        # 기다리는 동안 받아 둔 sync step1·커서를 이제 처리한다.
        held, self.held = self.held, []
        for data in held:
            await self.receive(bytes_data=data)

    async def _send_position(self, position: int) -> None:
        await self.send(bytes_data=daypage_message(MESSAGE_QUEUED, {"type": "queued", "position": position}))

    async def _wait(self) -> None:
        """대기열에서 순번을 알리며 기다리다 차례가 오면 들어간다."""
        store = admission.store()
        try:
            while True:
                await asyncio.sleep(settings.QUEUE_POLL_EVERY)
                await store.wait_add(self.waiter)  # 하트비트
                snap = await store.snapshot()
                decision = admission.decide(snap, self.waiter)
                if decision.admit:
                    return await self._enter()
                if decision.position == 1:
                    # 맨 앞 대기자가 자리 비움인 사람을 내보내 자리를 만든다.
                    await self._let_go_away(snap)
                await self._send_position(max(decision.position, 1))
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.warning("대기 중 오류", exc_info=True)
            await self.close()

    async def _let_go_away(self, snap: admission.Snapshot) -> None:
        store = admission.store()
        for conn in admission.away_to_let_go(snap, time.time(), settings.AWAY_AFTER):
            # 목록에서 바로 빼야 다음 판정 때 자리가 비어 보이고, 같은 사람을 또 고르지 않는다.
            await store.online_remove(conn)
            await self.channel_layer.send(conn.channel, {"type": "away.kick"})

    async def _heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(rooms.HEARTBEAT_EVERY)
                if self.conn:
                    await rooms.registry().touch(self.note_id, self.conn)
                if self.room is not None:
                    await self._still_allowed()  # 아무것도 보내지 않는(읽기만 하는) 연결도 끊기게
                if self.online:
                    store = admission.store()
                    await store.online_add(self.conn)
                    if self.last_input > self.input_reported:
                        self.input_reported = self.last_input
                        await store.report_input(self.channel_name, self.last_input)
        except asyncio.CancelledError:
            pass

    async def _still_allowed(self) -> bool:
        """들어온 뒤에도 쓸 수 있는지. 마지막 확인 뒤 RECHECK_AFTER가 지났으면 입장 때와 같은 판정(_recheck)을
        다시 하고, 막혔으면 입장 때와 같은 닫는 코드로 닫는다. 그 사이에는 시계만 비교한다."""
        async with self.recheck_lock:
            if self.revoked is not None:
                return False
            elapsed = clock.now() - self.checked_at
            if dt.timedelta(0) <= elapsed < RECHECK_AFTER:
                return True
            try:
                code, _ = await _recheck(self.note_id, self.member.user_id)
            except Exception:
                # DB가 잠깐 안 되면 연결을 죽이지 않는다(입장 때 이미 봤다). 다음 주기에 다시 본다.
                logger.warning("열린 연결 권한 재확인 실패", exc_info=True)
                code = None
            self.checked_at = clock.now()
            if code is None:
                return True
            self.revoked = code
        await self.close(code=code)
        return False

    async def _note_input(self) -> None:
        """편집·커서 변경을 받았다. 자리 비움 판정에 쓰도록 가끔 저장소에 올린다."""
        self.last_input = time.time()
        if self.online and self.last_input - self.input_reported >= admission.input_report_every():
            self.input_reported = self.last_input
            await admission.store().report_input(self.channel_name, self.last_input)

    async def away_kick(self, event) -> None:
        """대기자에게 자리를 돌리려고 내보낸다(다른 프로세스의 대기자가 보낼 수도 있다).
        접속 목록은 보낸 쪽이 이미 뺐다. 그 사이 하트비트가 다시 올렸어도 disconnect가 뺀다."""
        await self.close(code=CLOSE_AWAY)

    # ── 방이 부르는 것(hub.Member) ──────────────────────────────

    def push(self, data: bytes, volatile: bool = False) -> None:
        if self.closing:
            return
        if not self.outbox.full():
            self.outbox.put_nowait(data)
        elif not volatile:
            # 편집을 따라가지 못하는 연결은 끊는다(한 번만). 다시 접속하면 문서 전체를 다시 맞춘다.
            logger.warning("보낼 편집이 밀려 연결을 끊는다(장 %s)", self.page_id)
            self.closing = True
            asyncio.create_task(self.close(code=CLOSE_TOO_SLOW))

    async def _send_loop(self) -> None:
        try:
            while True:
                try:
                    data = await asyncio.wait_for(self.outbox.get(), KEEPALIVE_EVERY)
                except TimeoutError:
                    data = KEEPALIVE  # 한가하면 연결이 살아 있다고 알린다
                await self.send(bytes_data=data)
        except asyncio.CancelledError:
            pass
        except Exception:  # 이미 끊긴 연결: 더 쌓지 않는다. 정리는 disconnect가 한다.
            self.closing = True

    async def send(self, text_data=None, bytes_data=None, close=False) -> None:
        """보낸다. 클라이언트가 이미 떠났으면(ClientDisconnected) 조용히 끝내고 닫는 중으로 둔다.
        이 오류가 연결 처리(consumer)를 죽이면 정리(disconnect)가 돌지 않아 방·접속 목록에 남는다."""
        try:
            await super().send(text_data=text_data, bytes_data=bytes_data, close=close)
        except ClientDisconnected:
            self.closing = True

    async def close(self, code=None, reason=None) -> None:
        """닫는다. 클라이언트가 이미 떠났으면(ClientDisconnected) 닫을 것이 없으니 조용히 끝낸다."""
        self.closing = True
        try:
            await super().close(code=code, reason=reason)
        except ClientDisconnected:
            pass

    async def page_sealed(self, key: str | None, lost: int = 0) -> None:
        await self._tell_lost(lost)
        if key is None:
            await self.close(code=CLOSE_NOT_TODAY)
        else:
            await self._tell_rolled(key)

    async def page_gone(self) -> None:
        await self.close(code=CLOSE_NOT_FOUND)

    # ── 연결 종료 ──────────────────────────────────────────────

    async def __call__(self, scope, receive, send) -> None:
        """연결 처리. 어떻게 끝나든(예상 못 한 오류 포함) 정리(disconnect)를 한 번은 한다.
        Channels는 처리 중 오류로 끝나면 disconnect를 부르지 않아, 하트비트·방·보낼 편집이 프로세스에 남아
        메모리가 새고 떠난 사람이 접속 중으로 세어졌다."""
        try:
            await super().__call__(scope, receive, send)
        finally:
            if hasattr(self, "outbox") and not getattr(self, "cleaned_up", False):
                try:
                    await asyncio.shield(self.disconnect(None))
                except Exception:
                    logger.exception("연결 정리 실패")

    async def disconnect(self, code) -> None:
        if getattr(self, "cleaned_up", False):
            return
        self.cleaned_up = True
        self.closing = True
        if self.heartbeat:
            self.heartbeat.cancel()
            # 하트비트가 접속 목록에 다시 올리는 중이었다면 끝난 뒤에 빼야 남지 않는다.
            await asyncio.gather(self.heartbeat, return_exceptions=True)
        if self.sender:
            self.sender.cancel()
        if self.answering:
            self.answering.cancel()
        if self.roll_closer:
            self.roll_closer.cancel()
        if self.waiting and not self.waiting.done():
            # 들어가는 도중이면 마저 들어간 뒤 평소처럼 나간다(방에 반쯤 들어간 채 남지 않게).
            if not self.entering:
                self.waiting.cancel()
            try:
                await self.waiting
            except asyncio.CancelledError:
                pass
        store = admission.store()
        if self.waiter:
            await store.wait_remove(self.waiter)
        if self.online and self.conn:
            await store.online_remove(self.conn)
            self.online = False
        registry = rooms.registry()
        if self.room is None or self.conn is None:
            if self.conn:
                await registry.remove(self.note_id, self.conn)
            return
        room = self.room
        await self.channel_layer.group_discard(note_group(self.note_id), self.channel_name)
        await self.channel_layer.group_discard(moderation.user_group(self.member.user_id), self.channel_name)
        # 이 연결의 커서를 다른 사람 화면에서 지운다. 되돌려 보낸 남의 것은 건드리지 않는다.
        if (gone := presence_rules.farewell(self._seat(), self.client_clock, room.slot(self.client_id))) is not None:
            await room.local_awareness(self, [gone])
        closed = await hub.hub().leave(room, self)
        await registry.remove(self.note_id, self.conn)
        # 이 장에 아무도 남지 않았으면(다른 프로세스 포함) 스냅샷으로 합친다.
        remaining = [c for c in await registry.connections(self.note_id) if c.date == self.conn.date]
        if closed and not remaining and not room.gone:
            await db(pages.compact)(self.page_id)

    # ── 받기 ───────────────────────────────────────────────────

    async def receive(self, text_data=None, bytes_data=None) -> None:
        if not bytes_data:
            return
        kind = bytes_data[0]
        if self.room is None:
            # 대기 중: 문서·커서를 주고받지 않는다. 연결하자마자 보낸 sync step1·커서만 받아 두었다가
            # 들어간 뒤 처리한다(그래야 클라이언트가 문서를 받는다).
            held = kind == YMessageType.AWARENESS or (
                kind == YMessageType.SYNC and len(bytes_data) > 1 and bytes_data[1] == YSyncMessageType.SYNC_STEP1
            )
            if (self.waiter or self.entering) and held and len(self.held) < HELD_LIMIT:
                self.held.append(bytes_data)
            return
        if not await self._still_allowed():
            return  # 내보냄·정지·닫힘: 이 메시지는 저장하지도 퍼뜨리지도 않는다
        if kind == YMessageType.SYNC:
            await self._receive_sync(bytes_data)
        elif kind == YMessageType.AWARENESS:
            await self.receive_awareness(bytes_data)

    async def _receive_sync(self, data: bytes) -> None:
        sync_type = data[1]
        if sync_type == YSyncMessageType.SYNC_STEP1:
            # 답(step2)은 방이 지금까지 받은 편집이 모두 커밋된 뒤에 나간다. 클라이언트는 이 답을 「앞서 보낸 내 편집이
            # 저장됐다」로 읽는다(frontend/src/note/unsent.ts). 강제로 저장하지 않고 주기 저장을 기다리며, 기다리는 동안
            # 이 연결의 다른 메시지는 막지 않는다.
            self.answering = asyncio.create_task(self._answer(self.answering, self.room, self.room.received, data))
            return
        update = read_message(data[2:])
        if not update or update == EMPTY_UPDATE:
            return
        # 봉인 경계는 받은 시각으로 바로 판정한다(DB를 기다리지 않는다).
        received_at = clock.now()
        if self.room.sealed or boundary.past_due(received_at, self.due_at):
            await self._carry_late(update, received_at)
            return
        await self.room.local_update(self, update, received_at)
        await self._note_input()

    async def _carry_late(self, update: bytes, received_at: dt.datetime) -> None:
        """봉인 예정 뒤 옛 장으로 온 편집(#266, #268). 옛 장에는 넣지 않고 boundary가 정한 대로 지금 장의 같은 자리로
        옮긴 뒤 장이 바뀌었다고 알린다. 옛 장에 남은 것을 고친 편집은 버리고 그 수를 알린다(옛 장은 봉인 때 모습 그대로)."""
        try:
            carried = await self.room.carry_late(update, received_at, base=self.room.ydoc.get_update())
        except (Note.DoesNotExist, Page.DoesNotExist):
            return await self.close(code=CLOSE_NOT_FOUND)
        if carried.page.id == self.page_id:
            # 봉인 예정이 뒤로 미뤄졌는데 아직 못 들었다(또는 바로 봉인이 도는 중): 아직 이 장이다
            self.due_at = carried.page.due_at
            if not self.room.sealed:
                await self.room.local_update(self, update, received_at)
            return
        await self._tell_lost(carried.lost)
        await self._tell_rolled(pages.page_key(carried.page.date, carried.page.seq))

    async def _tell_lost(self, count: int) -> None:
        if count > 0:
            await self.send(bytes_data=daypage_message(MESSAGE_EDITS_LOST, {"type": "edits_lost", "count": count}))

    async def _answer(self, before: asyncio.Task | None, room: hub.Room, through: int, data: bytes) -> None:
        """sync step1에 답한다. 앞선 답이 먼저 나가고, 방이 받은 편집 through개가 커밋돼야 나간다.
        봉인·삭제로 저장할 수 없으면 답하지 않는다(연결은 방이 닫는다)."""
        if before is not None:
            await asyncio.wait([before])
        if not await room.saved_through(through) or self.closing:
            return
        reply = handle_sync_message(data[1:], room.ydoc)
        if reply is not None:
            await self.send(bytes_data=reply)

    def _seat(self) -> presence_rules.Seat:
        return presence_rules.Seat(self, self.member.user_id, self.client_id, self.clock_shift)

    async def receive_awareness(self, data: bytes) -> None:
        """자기 clientID의 커서만 받고, 닉네임·색은 클라이언트가 보낸 값 대신 서버가 배정한 값으로 바꿔 퍼뜨린다."""
        try:
            entries = awareness.decode_message(data)
        except Exception:
            logger.warning("잘못된 awareness 메시지", exc_info=True)
            return
        cleaned: list[awareness.Entry] = []
        moved = False
        for client_id, clk, state in entries:
            # 받아들일지·쥘지·clock은 presence_rules가 정한다(#228·#230).
            verdict = presence_rules.receive(self._seat(), client_id, clk, state, self.room.slot(client_id))
            if verdict.claim:
                self.room.hold(self, self.member.user_id, client_id)
                self.client_id, self.clock_shift = client_id, verdict.shift
            if not verdict.accept:
                continue
            clk = verdict.clock
            if state is None:
                self.client_clock = None
                self.cursor_state = None
                cleaned.append((client_id, clk, None))
                continue
            # 클라이언트는 같은 상태를 15초마다 다시 보낸다. 바뀐 것만 입력으로 친다(자리 비움 판정).
            seen = (json.dumps(state.get("cursor")), state.get("editingBoxId"))
            if self.cursor_state is not None and self.cursor_state != seen:
                moved = True
            self.cursor_state = seen
            state = presence_rules.restate(state, self.member.nickname, self.member.color)
            self.client_clock = clk
            cleaned.append((client_id, clk, state))
        if self.presence_later is not None and self.client_id is not None:
            later, self.presence_later = self.presence_later, None
            if rest := presence_rules.deferred(later, self.client_id, self.room.presence_entries()):
                self.push(awareness.encode_message(rest), volatile=True)
        if cleaned:
            await self.room.local_awareness(self, cleaned)
        if moved:
            await self._note_input()

    # ── 노트 그룹 알림 ─────────────────────────────────────────

    async def page_rolled(self, event) -> None:
        """페이지 교체: 새 장의 키를 알린다. 클라이언트는 새 장 방으로 옮겨 간다."""
        if event["key"] == self.key:
            return
        await self._tell_rolled(event["key"])

    async def _tell_rolled(self, key: str) -> None:
        """새 장의 키를 한 번 알리고, settings.ROLL_CLOSE_AFTER 뒤에도 남아 있으면 닫는다. 바로 닫지 않는다: 알림이 가는 사이
        클라이언트가 보낸 편집도 읽어 옛 장(봉인 예정 전에 받은 것)이나 새 장(뒤에 받은 획)에 남긴다."""
        if self.rolled:
            return
        self.rolled = True
        payload = json.dumps({"type": "page_rolled", "key": key}, separators=(",", ":")).encode()
        await self.send(bytes_data=bytes([MESSAGE_PAGE_ROLLED]) + write_message(payload))
        if settings.ROLL_CLOSE_AFTER <= 0:
            await self.close(code=CLOSE_NOT_TODAY)
        else:
            self.roll_closer = asyncio.create_task(self._close_after_roll())

    async def _close_after_roll(self) -> None:
        await asyncio.sleep(settings.ROLL_CLOSE_AFTER)
        await self.close(code=CLOSE_NOT_TODAY)

    async def note_page(self, event) -> None:
        """주인이 봉인 시각을 바꿨다: 이 장의 봉인 예정 시각이 바뀌었다. 모두의 카운트다운을 바꾸도록 전한다."""
        if event["key"] == self.key:
            self.due_at = dt.datetime.fromisoformat(event["dueAt"])
        self.push(
            daypage_message(
                MESSAGE_NOTE_PAGE,
                {"type": "note_page", "key": event["key"], "dueAt": event["dueAt"], "sealHour": event["sealHour"]},
            )
        )

    async def note_colors(self, event) -> None:
        """노트 색이 바뀌었다. 도구 막대를 바로 바꾸도록 전한다."""
        self.push(daypage_message(MESSAGE_NOTE_COLORS, {"type": "note_colors", "colors": event["colors"]}))

    async def note_paper(self, event) -> None:
        """노트 종이가 바뀌었다. 모두의 화면 종이를 바로 바꾸도록 전한다."""
        self.push(daypage_message(MESSAGE_NOTE_PAPER, {"type": "note_paper", "paper": event["paper"]}))

    async def note_info(self, event) -> None:
        """노트 이름·참여 수·정원이 바뀌었다. 모두의 머리말을 바로 바꾸도록 전한다."""
        self.push(note_info_message(event))

    async def note_deleted(self, event) -> None:
        """만든 사람이 노트를 지웠다. 장도 함께 사라졌으니 저장·합치기를 하지 않고 닫는다."""
        if self.room is not None:
            self.room.gone = True
        await self.close(code=CLOSE_NOT_FOUND)

    # ── 운영 조치(moderation.py) ────────────────────────────────

    async def note_closed(self, event) -> None:
        """운영자가 노트를 닫았다. 장은 그대로 두고(저장도 평소처럼) 연결만 닫는다."""
        await self.close(code=CLOSE_CLOSED)

    async def user_suspended(self, event) -> None:
        """운영자가 이 사용자를 정지했다."""
        await self.close(code=CLOSE_SUSPENDED)

    async def member_kicked(self, event) -> None:
        """노트를 만든 사람이 이 사용자를 내보냈다(다른 노트 연결은 그대로)."""
        if event.get("note") == self.note_id:
            await self.close(code=CLOSE_KICKED)
