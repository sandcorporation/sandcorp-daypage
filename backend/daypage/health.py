"""/api/health가 보는 의존성 점검과 celery 생존 신호.

beat가 15초마다 heartbeat 작업을 내고 worker가 그것을 실행해 HEARTBEAT_KEY를 TTL과 함께 갱신한다.
키가 있으면 beat와 worker가 둘 다 살아 있다는 뜻이다.
"""

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Literal

import redis
from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

Check = Literal["db", "redis", "worker"]

HEARTBEAT_KEY = "daypage:celery:heartbeat"
HEARTBEAT_TTL = 90
# 점검 하나가 이보다 오래 걸리면 실패로 본다(초).
CHECK_TIMEOUT = 1.0


def _redis() -> redis.Redis:
    return redis.Redis.from_url(
        settings.REDIS_URL, socket_timeout=CHECK_TIMEOUT, socket_connect_timeout=CHECK_TIMEOUT
    )


def beat() -> None:
    """worker가 heartbeat 작업에서 부른다."""
    with _redis() as r:
        r.set(HEARTBEAT_KEY, "1", ex=HEARTBEAT_TTL)


def worker_alive() -> bool:
    """worker 컨테이너 healthcheck가 부른다."""
    with _redis() as r:
        return bool(r.exists(HEARTBEAT_KEY))


def _check_db() -> None:
    # 요청 스레드가 아닌 점검 스레드의 연결이므로 끝나면 닫아 풀에 돌려준다.
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    finally:
        connection.close()


def _check_redis() -> None:
    with _redis() as r:
        r.ping()


def _check_worker() -> None:
    if not worker_alive():
        raise RuntimeError("생존 신호 키가 없다")


CHECKS: dict[Check, Callable[[], None]] = {
    "db": _check_db,
    "redis": _check_redis,
    "worker": _check_worker,
}


def failed_checks(names: list[Check]) -> list[Check]:
    """점검을 나란히 돌려 실패한(또는 CHECK_TIMEOUT 안에 안 끝난) 것의 이름을 names 순서로 돌려준다."""
    pool = ThreadPoolExecutor(max_workers=len(names), thread_name_prefix="health")
    try:
        futures = {name: pool.submit(CHECKS[name]) for name in names}
        wait(futures.values(), timeout=CHECK_TIMEOUT)
        failed: list[Check] = []
        for name, future in futures.items():
            if not future.done():
                logger.warning("health %s: %s초 안에 끝나지 않았다", name, CHECK_TIMEOUT)
                failed.append(name)
            elif (exc := future.exception()) is not None:
                logger.warning("health %s 실패: %r", name, exc)
                failed.append(name)
        return failed
    finally:
        # 멈춘 점검을 기다리지 않는다(응답은 이미 정해졌다).
        pool.shutdown(wait=False, cancel_futures=True)
