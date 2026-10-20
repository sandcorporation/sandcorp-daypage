"""운영과 같은 Redis 채널 레이어에서 허브와 연결이 함께 기다려도 둘 다 메시지를 받는다.

channels_redis는 한 프로세스(레이어)에 받기 잠금이 하나다. 잠금을 쥔 쪽은 자기 채널 이름 앞부분의
목록만 기다리므로, 허브 채널을 다른 앞부분('daypage-hub')으로 만들면 허브가 잠금을 쥔 동안 연결
('specific')에 온 메시지(노트 색·종이·자정 교체·지움)를 아무도 읽지 않았고, 거꾸로 다른 프로세스의
편집이 허브에 늦게 갈 수도 있었다. 테스트는 보통 메모리 레이어를 쓰므로 여기서만 Redis로 확인한다
(로컬 Redis가 없으면 건너뛴다).
"""

import asyncio

import pytest
from django.conf import settings

pytestmark = pytest.mark.asyncio

from config import settings as project_settings  # noqa: E402


def redis_layer():
    from channels_redis.core import RedisChannelLayer

    cfg = project_settings.CHANNEL_LAYERS["default"]["CONFIG"]
    return RedisChannelLayer(hosts=cfg["hosts"], prefix="daypage-test")


async def reachable(layer) -> bool:
    try:
        await asyncio.wait_for(layer.new_channel(), 2)
        conn = layer.connection(0)
        await asyncio.wait_for(conn.ping(), 2)
        return True
    except Exception:
        return False


async def test_hub_and_connection_waiting_together_both_receive(monkeypatch):
    from daypage import hub

    layer = redis_layer()
    if not await reachable(layer):
        pytest.skip("로컬 Redis가 없다")
    monkeypatch.setattr(hub, "get_channel_layer", lambda: layer)
    h = hub.Hub()
    await h._start()  # 허브가 먼저 자기 채널을 기다리기 시작한다(서버와 같은 순서)
    await asyncio.sleep(0.3)

    conn = await layer.new_channel()  # Channels가 연결마다 만드는 채널과 같은 방식
    await layer.group_add("probe.note", conn)
    got = []

    async def consumer():
        while True:
            got.append((await layer.receive(conn))["n"])

    task = asyncio.create_task(consumer())
    await asyncio.sleep(0.3)
    for i in range(3):
        await layer.group_send("probe.note", {"type": "x", "n": i})
        await asyncio.sleep(0.2)
    await asyncio.sleep(0.5)
    assert got == [0, 1, 2]

    # 허브 채널로 온 다른 프로세스 메시지도 허브가 받는다
    seen = []
    monkeypatch.setattr(h, "_dispatch", lambda event: seen.append(event) or asyncio.sleep(0))
    await layer.send(h.channel, {"type": "hub.bye", "page": 1})
    await asyncio.sleep(0.5)
    assert seen and seen[0]["type"] == "hub.bye"

    task.cancel()
    h.reader.cancel()
    h.trimmer.cancel()
    await layer.group_discard("probe.note", conn)
    assert settings.CHANNEL_LAYERS  # 사용 안 함 경고 방지
