"""사건 기다리기 도우미. 시험은 시간을 기다리지 않고 「그렇게 될 때까지」 기다린다(CLAUDE.md 「시험 시간 한도」)."""

import asyncio
from collections.abc import Callable


async def until(condition: Callable[[], object], timeout: float = 3.0) -> None:
    """조건이 참이 될 때까지 기다린다. 앱에 걸 사건이 없을 때만 쓴다(있으면 asyncio.Event 를 기다린다).

    시간 초과면 실패시킨다. 정해진 시간 뒤에 보는 것이 아니라 조건이 맞는 즉시 돌아온다."""
    async with asyncio.timeout(timeout):
        while not condition():
            await asyncio.sleep(0.002)  # noqa: TID251 -- 조건 기다리기 도우미 본체: 이 한 곳에서만 짧게 양보한다
