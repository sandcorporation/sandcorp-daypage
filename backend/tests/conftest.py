import os
import resource
import time

import pytest

from daypage import admission, rooms


@pytest.fixture(autouse=True)
def _test_settings(settings):
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    settings.ROOM_REGISTRY_URL = None
    settings.KAKAO_REST_API_KEY = "test-rest-key"
    settings.KAKAO_CLIENT_SECRET = "test-secret"
    settings.KAKAO_REDIRECT_URI = "http://testserver/auth/kakao/callback"
    settings.ALLOWED_HOSTS = ["localhost", "testserver"]
    # 이 컴퓨터의 cgroup과 상관없이 수용 인원 제한을 끈다(test_capacity가 따로 켠다).
    settings.CGROUP_CPU_MAX_PATH = "/nonexistent/cpu.max"
    rooms.reset_registry()
    admission.reset_store()
    yield
    rooms.reset_registry()
    admission.reset_store()


_CPU_LIMIT_SECONDS = float(os.environ.get("DAYPAGE_TEST_CPU_LIMIT", "1.0"))


def _extra_charged_cpu_seconds() -> float:
    """자식 프로세스 중 `RUSAGE_CHILDREN` 에 안 잡히는 몫이 있으면 여기서 더한다.

    예: multiprocessing forkserver 의 자식은 이 프로세스의 자식이 아니다 — 자식이 자기 사용량을
    돌려주게 해서 합산한다 (codemit `tests/boot_process.py` 의 `charged_cpu_seconds`).
    그런 것이 없으면 0.0 그대로 둔다.
    """

    return 0.0


def _cpu_seconds() -> float:
    children = resource.getrusage(resource.RUSAGE_CHILDREN)
    return time.process_time() + children.ru_utime + children.ru_stime + _extra_charged_cpu_seconds()


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item):
    started = _cpu_seconds()
    try:
        return (yield)
    finally:
        item._cpu_seconds_spent = _cpu_seconds() - started


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item, call):
    report = yield
    spent = getattr(item, "_cpu_seconds_spent", None)
    if report.when == "call" and spent is not None:
        # junitxml 은 teardown 보고서의 user_properties 를 쓰고, pytest 는 보고서마다 item 의
        # 목록을 복사한다 — item 과 report 양쪽에 넣어야 junit 에 남는다 (codemit #701).
        item.user_properties.append(("cpu_seconds", round(spent, 3)))
        report.user_properties.append(("cpu_seconds", round(spent, 3)))
        if _CPU_LIMIT_SECONDS > 0 and spent > _CPU_LIMIT_SECONDS and report.passed:
            report.outcome = "failed"
            report.longrepr = (
                f"시험 본문이 CPU {spent:.2f}초를 썼다 — 한도 {_CPU_LIMIT_SECONDS:.2f}초"
                " (DAYPAGE_TEST_CPU_LIMIT). 원인을 찾아 줄인다; 한도를 늘리지 않는다."
            )
    return report


@pytest.fixture(scope="session", autouse=True)
def _load_urlconf_before_any_test():
    # 첫 요청의 URLconf 적재(CPU 0.4초대)를 시험 본문이 아니라 준비 단계에서 치른다.
    from django.urls import get_resolver

    assert get_resolver().url_patterns
