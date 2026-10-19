"""접근 로그 거르기."""

import logging

# 헬스 체크(도커 healthcheck가 30초마다, 배포가 뜰 때마다) 접근 로그는 남기지 않는다.
# 로그의 대부분을 차지해 정작 볼 요청을 가렸다.
QUIET_PATHS = {"/api/health"}


def skip_health(record: logging.LogRecord) -> bool:
    """남길 기록이면 True. uvicorn 접근 로그의 args는 (클라이언트, 메서드, 경로, HTTP 버전, 상태)."""
    args = record.args
    return not (isinstance(args, tuple) and len(args) >= 3 and args[2] in QUIET_PATHS)


def install_access_log_filter() -> None:
    logger = logging.getLogger("uvicorn.access")
    if skip_health not in logger.filters:
        logger.addFilter(skip_health)
