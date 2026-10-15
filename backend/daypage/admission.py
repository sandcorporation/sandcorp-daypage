"""수용 인원(Capacity)·대기열(Waiting Line)·자리 비움(Away).

- 백엔드 프로세스마다 자기 컨테이너의 CPU 제한(cgroup v2 cpu.max) × MAX_ONLINE_PER_CORE를 자기 몫으로
  하트비트처럼 올린다. 수용 인원은 살아 있는 프로세스 몫의 합이다. 제한 없는 프로세스가 하나라도 있으면
  수용 인원 제한을 끈다(로컬·테스트).
- 서비스 전체에서 노트에 실시간 접속한 연결 목록(online)과 대기열(waiting)을 둔다. 사람 수는 사용자 단위로 센다.
- 입장 판정은 먼저 대기열에 선 뒤, 두 목록을 한 번에 읽은 스냅샷으로 한다(decide). 입장하면 online에 먼저
  넣고 대기열에서 뺀다. 여러 프로세스가 동시에 판정해도 수용 인원을 넘지 않는다.
- 대기열 맨 앞 사람은 기다리는 동안 자리 비움(마지막 입력이 AWAY_AFTER를 넘음)인 사람을 오래된 순으로
  필요한 만큼 내보낸다(away_to_let_go).

프로세스가 여러 개여도 같은 값을 보도록 Redis에 둔다. 테스트에서는 같은 프로세스 안의 메모리 구현을 쓴다.
"""

import asyncio
import math
import threading
import time
import uuid
from dataclasses import dataclass

import redis.asyncio as aredis
from django.conf import settings

from .rooms import HEARTBEAT_EVERY, STALE_AFTER, Conn, _decode_all

# 프로세스 몫은 이 간격으로 다시 올리고, 이만큼의 세 배 동안 소식이 없으면 죽은 것으로 본다.
SHARE_EVERY = 10
SHARE_STALE_AFTER = SHARE_EVERY * 3
# 대기자 항목이 이 시간 동안 갱신되지 않으면 떠난 것으로 본다(대기자는 QUEUE_POLL_EVERY마다 갱신).
WAIT_STALE_AFTER = 30

UNLIMITED = -1.0

PROCESS_ID = uuid.uuid4().hex


def read_cpu_limit(path: str) -> float | None:
    """cgroup v2 cpu.max("65000 100000" → 0.65)를 읽는다. 제한이 없거나(max) 읽을 수 없으면 None."""
    try:
        with open(path) as f:
            quota, period = f.read().split()[:2]
        if quota == "max":
            return None
        return int(quota) / int(period)
    except (OSError, ValueError):
        return None


def my_share() -> float:
    cores = read_cpu_limit(settings.CGROUP_CPU_MAX_PATH)
    return UNLIMITED if cores is None else cores * settings.MAX_ONLINE_PER_CORE


def capacity_of(shares: list[float]) -> int | None:
    """살아 있는 프로세스 몫의 합. 제한 없는 프로세스가 있거나 아무도 없으면 None(제한 없음)."""
    if not shares or any(s < 0 for s in shares):
        return None
    return math.floor(sum(shares) + 1e-6)


@dataclass(frozen=True)
class Waiter:
    user_id: int
    arrived: float
    channel: str

    def encode(self) -> str:
        return f"{self.user_id}|{self.arrived!r}|{self.channel}"

    @staticmethod
    def decode(raw: str) -> "Waiter":
        user_id, arrived, channel = raw.split("|", 2)
        return Waiter(int(user_id), float(arrived), channel)


@dataclass(frozen=True)
class Snapshot:
    capacity: int | None
    online: list[Conn]
    waiting: list[Waiter]
    # 연결(채널)별 마지막 입력 시각
    inputs: dict[str, float]


@dataclass(frozen=True)
class Decision:
    admit: bool = False
    full: bool = False
    # 대기 순번(1부터)
    position: int = 0


def decide(snap: Snapshot, me: Waiter) -> Decision:
    """대기열에 선 me가 지금 들어갈 수 있는지."""
    if snap.capacity is None:
        return Decision(admit=True)
    online = {c.user_id for c in snap.online}
    if me.user_id in online:
        return Decision(admit=True)
    # 이미 들어온 사람의 다른 탭은 줄에서 곧 빠지므로 세지 않는다. 한 사람이 탭 여럿으로 서 있어도 1명.
    ahead = {
        w.user_id
        for w in snap.waiting
        if (w.arrived, w.channel) < (me.arrived, me.channel) and w.user_id not in online and w.user_id != me.user_id
    }
    free = snap.capacity - len(online)
    if len(ahead) < free:
        return Decision(admit=True)
    if len(ahead) >= snap.capacity:
        return Decision(full=True)
    return Decision(position=len(ahead) + 1)


def away_to_let_go(snap: Snapshot, now: float, away_after: float) -> list[Conn]:
    """대기자를 들일 만큼, 자리 비움인 사람의 연결을 마지막 입력이 오래된 사람부터 고른다."""
    if snap.capacity is None:
        return []
    online = {c.user_id for c in snap.online}
    waiting = {w.user_id for w in snap.waiting if w.user_id not in online}
    need = len(waiting) - (snap.capacity - len(online))
    if need <= 0:
        return []
    last_input: dict[int, float] = {}
    for c in snap.online:
        t = snap.inputs.get(c.channel, c.joined)
        last_input[c.user_id] = max(t, last_input.get(c.user_id, t))
    away = sorted((t, u) for u, t in last_input.items() if now - t > away_after)
    chosen = {u for _, u in away[:need]}
    return [c for c in snap.online if c.user_id in chosen]


# ── 저장소 ─────────────────────────────────────────────────────


class MemoryStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._shares: dict[str, tuple[float, float]] = {}
        self._online: dict[str, float] = {}
        self._waiting: dict[str, float] = {}
        self._inputs: dict[str, float] = {}

    async def publish_share(self, share: float) -> None:
        with self._lock:
            self._shares[PROCESS_ID] = (share, time.time())

    async def online_add(self, conn: Conn) -> None:
        with self._lock:
            self._online[conn.encode()] = time.time()

    async def online_remove(self, conn: Conn) -> None:
        with self._lock:
            self._online.pop(conn.encode(), None)
            self._inputs.pop(conn.channel, None)

    async def report_input(self, channel: str, at: float) -> None:
        with self._lock:
            self._inputs[channel] = at

    async def wait_add(self, waiter: Waiter) -> None:
        with self._lock:
            self._waiting[waiter.encode()] = time.time()

    async def wait_remove(self, waiter: Waiter) -> None:
        with self._lock:
            self._waiting.pop(waiter.encode(), None)

    async def snapshot(self) -> Snapshot:
        now = time.time()
        with self._lock:
            for table, stale in ((self._online, STALE_AFTER), (self._waiting, WAIT_STALE_AFTER)):
                for raw, ts in list(table.items()):
                    if now - ts > stale:
                        del table[raw]
            shares = [s for s, ts in self._shares.values() if now - ts <= SHARE_STALE_AFTER]
            return Snapshot(
                capacity_of(shares),
                _decode_all(self._online),
                [Waiter.decode(raw) for raw in self._waiting],
                dict(self._inputs),
            )

    def clear(self) -> None:
        with self._lock:
            self._shares.clear()
            self._online.clear()
            self._waiting.clear()
            self._inputs.clear()


SHARES = "daypage:capacity"
ONLINE = "daypage:live"
WAITING = "daypage:waiting"
INPUTS = "daypage:input"


class RedisStore:
    """zset 점수는 마지막 하트비트 시각이다. 몫은 'PROCESS_ID|몫'을 멤버로 둔다."""

    def __init__(self, url: str) -> None:
        self._url = url
        self._share_member: str | None = None

    def _r(self) -> aredis.Redis:
        return aredis.Redis.from_url(self._url, decode_responses=True)

    async def publish_share(self, share: float) -> None:
        member = f"{PROCESS_ID}|{share!r}"
        async with self._r() as r, r.pipeline(transaction=True) as p:
            if self._share_member and self._share_member != member:
                p.zrem(SHARES, self._share_member)
            p.zadd(SHARES, {member: time.time()})
            p.expire(SHARES, SHARE_STALE_AFTER * 4)
            await p.execute()
        self._share_member = member

    async def online_add(self, conn: Conn) -> None:
        async with self._r() as r, r.pipeline(transaction=True) as p:
            p.zadd(ONLINE, {conn.encode(): time.time()})
            p.expire(ONLINE, STALE_AFTER * 4)
            await p.execute()

    async def online_remove(self, conn: Conn) -> None:
        async with self._r() as r, r.pipeline(transaction=True) as p:
            p.zrem(ONLINE, conn.encode())
            p.hdel(INPUTS, conn.channel)
            await p.execute()

    async def report_input(self, channel: str, at: float) -> None:
        async with self._r() as r, r.pipeline(transaction=True) as p:
            p.hset(INPUTS, channel, repr(at))
            p.expire(INPUTS, STALE_AFTER * 4)
            await p.execute()

    async def wait_add(self, waiter: Waiter) -> None:
        async with self._r() as r, r.pipeline(transaction=True) as p:
            p.zadd(WAITING, {waiter.encode(): time.time()})
            p.expire(WAITING, WAIT_STALE_AFTER * 4)
            await p.execute()

    async def wait_remove(self, waiter: Waiter) -> None:
        async with self._r() as r:
            await r.zrem(WAITING, waiter.encode())

    async def snapshot(self) -> Snapshot:
        now = time.time()
        # 한 트랜잭션으로 읽어야 다른 프로세스가 입장하는 중간 상태를 보지 않는다.
        async with self._r() as r, r.pipeline(transaction=True) as p:
            p.zremrangebyscore(SHARES, 0, now - SHARE_STALE_AFTER)
            p.zremrangebyscore(ONLINE, 0, now - STALE_AFTER)
            p.zremrangebyscore(WAITING, 0, now - WAIT_STALE_AFTER)
            p.zrange(SHARES, 0, -1)
            p.zrange(ONLINE, 0, -1)
            p.zrange(WAITING, 0, -1)
            p.hgetall(INPUTS)
            *_, shares, online, waiting, inputs = await p.execute()
        conns = _decode_all(online)
        live = {c.channel for c in conns}
        return Snapshot(
            capacity_of([float(m.split("|", 1)[1]) for m in shares]),
            conns,
            [Waiter.decode(raw) for raw in waiting],
            {ch: float(t) for ch, t in inputs.items() if ch in live},
        )


_store: MemoryStore | RedisStore | None = None


def store() -> MemoryStore | RedisStore:
    global _store
    if _store is None:
        url = getattr(settings, "ROOM_REGISTRY_URL", None)
        _store = RedisStore(url) if url else MemoryStore()
    return _store


def reset_store() -> None:
    global _store
    _store = None
    _publishers.clear()


# 이벤트 루프마다 몫을 올리는 태스크 하나(운영에서는 프로세스마다 하나)
_publishers: dict[asyncio.AbstractEventLoop, asyncio.Task] = {}


async def _publish_forever() -> None:
    try:
        while True:
            await asyncio.sleep(SHARE_EVERY)
            await store().publish_share(my_share())
    except asyncio.CancelledError:
        pass


async def publish_share() -> None:
    """지금 몫을 올리고, 연결이 없을 때도 계속 올리도록 이 프로세스의 하트비트를 띄운다."""
    await store().publish_share(my_share())
    loop = asyncio.get_running_loop()
    task = _publishers.get(loop)
    if task is None or task.done():
        for other in [lp for lp in _publishers if lp.is_closed()]:
            del _publishers[other]
        _publishers[loop] = loop.create_task(_publish_forever())


def input_report_every() -> float:
    """마지막 입력 시각을 저장소에 올리는 최소 간격. 자리 비움 기준보다 충분히 짧게."""
    return min(HEARTBEAT_EVERY, settings.AWAY_AFTER / 4)
