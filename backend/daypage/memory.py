"""비운 메모리를 운영체제에 돌려주기.

방(장 문서)을 열고 닫으며 파이썬·pycrdt가 큰 메모리를 잡았다 놓는데, glibc는 놓은 메모리를 바로
돌려주지 않고 들고 있어 프로세스 메모리(RSS)가 줄지 않았다(운영: 힙 318MB 중 206MB가 빈 채 남음).
방이 닫힐 때 malloc_trim으로 돌려준다(한 번 부르면 355MB → 229MB). 너무 자주 부르지 않게 간격을 둔다.
"""

import asyncio
import ctypes
import ctypes.util
import logging
import time

logger = logging.getLogger(__name__)

# 최소 간격(초). 방이 몰려 닫혀도 1분에 한 번만.
MIN_INTERVAL = 60.0

_last = 0.0
_libc = None
_looked_up = False


def _trim() -> None:
    """glibc가 있으면 malloc_trim(0). 없으면(윈도·macOS·musl) 아무 일도 하지 않는다."""
    global _libc, _looked_up
    if not _looked_up:
        _looked_up = True
        name = ctypes.util.find_library("c")
        try:
            lib = ctypes.CDLL(name) if name else None
            _libc = lib if lib is not None and hasattr(lib, "malloc_trim") else None
        except OSError:
            _libc = None
    if _libc is not None:
        _libc.malloc_trim(0)


_pending = None


def _run() -> None:
    global _last, _pending
    _pending = None
    _last = time.monotonic()
    try:
        _trim()
    except Exception:  # 메모리 돌려주기 실패가 방 닫기를 막지 않게
        logger.warning("malloc_trim 실패", exc_info=True)


def release() -> None:
    """비운 메모리를 돌려준다. MIN_INTERVAL 안에 또 부르면 건너뛰지 않고 간격이 끝날 때 한 번 한다
    (건너뛰기만 하면 그 뒤에 놓은 메모리가 다음 기회까지 그대로 남았다)."""
    global _pending
    wait = _last + MIN_INTERVAL - time.monotonic()
    if wait <= 0:
        _run()
        return
    if _pending is not None:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # 이벤트 루프 밖(관리 명령 등): 다음 기회에
        return
    _pending = loop.call_later(wait, _run)
