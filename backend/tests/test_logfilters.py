import logging

from config.logfilters import install_access_log_filter, skip_health


def access_record(path: str) -> logging.LogRecord:
    # uvicorn 접근 로그와 같은 모양: '%s - "%s %s HTTP/%s" %d'
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d', ("127.0.0.1:5000", "GET", path, "1.1", 200), None
    )


def test_health_check_is_not_logged():
    assert skip_health(access_record("/api/health")) is False


def test_other_requests_are_still_logged():
    assert skip_health(access_record("/api/me")) is True
    assert skip_health(access_record("/api/healthy-notes")) is True
    assert skip_health(logging.LogRecord("x", logging.INFO, __file__, 1, "plain", None, None)) is True


def test_installed_on_uvicorn_access_logger_once():
    logger = logging.getLogger("uvicorn.access")
    install_access_log_filter()
    install_access_log_filter()
    assert logger.filters.count(skip_health) == 1
    assert logger.filter(access_record("/api/health")) is False
