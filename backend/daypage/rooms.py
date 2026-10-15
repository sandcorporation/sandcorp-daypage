"""지금 접속한 연결 목록. 프로세스가 여러 개여도 같은 값을 보도록 Redis에 둔다.

연결마다 하트비트로 시각을 갱신하고, 오래 갱신되지 않은 항목은 끊긴 것으로 본다.
테스트에서는 같은 프로세스 안의 메모리 구현을 쓴다.
"""

import threading
import time
from dataclasses import dataclass

import redis
import redis.asyncio as aredis
from django.conf import settings

STALE_AFTER = 90  # 초. 하트비트는 30초마다.
HEARTBEAT_EVERY = 30


@dataclass(frozen=True)
class Conn:
    date: str
    channel: str
    user_id: int

    def encode(self) -> str:
        return f"{self.date}|{self.user_id}|{self.channel}"

    @staticmethod
    def decode(raw: str) -> "Conn":
        date, user_id, channel = raw.split("|", 2)
        return Conn(date, channel, int(user_id))


def _key(note_id: str) -> str:
    return f"daypage:online:{note_id}"


class MemoryRegistry:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, float]] = {}
        self._lock = threading.Lock()

    def _live(self, note_id: str) -> list[Conn]:
        now = time.time()
        with self._lock:
            entries = self._data.setdefault(note_id, {})
            for raw, ts in list(entries.items()):
                if now - ts > STALE_AFTER:
                    del entries[raw]
            return [Conn.decode(raw) for raw in entries]

    async def add(self, note_id: str, conn: Conn) -> None:
        with self._lock:
            self._data.setdefault(note_id, {})[conn.encode()] = time.time()

    async def touch(self, note_id: str, conn: Conn) -> None:
        await self.add(note_id, conn)

    async def remove(self, note_id: str, conn: Conn) -> None:
        with self._lock:
            self._data.get(note_id, {}).pop(conn.encode(), None)

    async def connections(self, note_id: str) -> list[Conn]:
        return self._live(note_id)

    def connections_sync(self, note_id: str) -> list[Conn]:
        return self._live(note_id)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


class RedisRegistry:
    def __init__(self, url: str) -> None:
        self._url = url
        self._sync = redis.Redis.from_url(url, decode_responses=True)

    def _async(self) -> aredis.Redis:
        # 이벤트 루프마다 연결이 달라야 하므로 호출마다 만든다(연결 풀은 내부에서 재사용).
        return aredis.Redis.from_url(self._url, decode_responses=True)

    async def add(self, note_id: str, conn: Conn) -> None:
        async with self._async() as r:
            await r.zadd(_key(note_id), {conn.encode(): time.time()})
            await r.expire(_key(note_id), STALE_AFTER * 4)

    async def touch(self, note_id: str, conn: Conn) -> None:
        await self.add(note_id, conn)

    async def remove(self, note_id: str, conn: Conn) -> None:
        async with self._async() as r:
            await r.zrem(_key(note_id), conn.encode())

    async def connections(self, note_id: str) -> list[Conn]:
        async with self._async() as r:
            await r.zremrangebyscore(_key(note_id), 0, time.time() - STALE_AFTER)
            return [Conn.decode(raw) for raw in await r.zrange(_key(note_id), 0, -1)]

    def connections_sync(self, note_id: str) -> list[Conn]:
        self._sync.zremrangebyscore(_key(note_id), 0, time.time() - STALE_AFTER)
        return [Conn.decode(raw) for raw in self._sync.zrange(_key(note_id), 0, -1)]


_registry: MemoryRegistry | RedisRegistry | None = None


def registry() -> MemoryRegistry | RedisRegistry:
    global _registry
    if _registry is None:
        url = getattr(settings, "ROOM_REGISTRY_URL", None)
        _registry = RedisRegistry(url) if url else MemoryRegistry()
    return _registry


def reset_registry() -> None:
    global _registry
    _registry = None


def online_users(conns: list[Conn], date: str | None = None) -> int:
    return len({c.user_id for c in conns if date is None or c.date == date})
