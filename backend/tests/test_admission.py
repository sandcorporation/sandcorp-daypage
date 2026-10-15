"""수용 인원 계산: 프로세스마다 CPU 제한 × 코어당 인원, 살아 있는 프로세스 몫의 합."""

import time

import pytest

from daypage import admission


def test_reads_cgroup_cpu_limit(tmp_path):
    path = tmp_path / "cpu.max"
    path.write_text("65000 100000\n")
    assert admission.read_cpu_limit(str(path)) == pytest.approx(0.65)
    path.write_text("max 100000\n")
    assert admission.read_cpu_limit(str(path)) is None
    assert admission.read_cpu_limit(str(tmp_path / "missing")) is None


def test_capacity_is_sum_of_shares():
    assert admission.capacity_of([0.65 * 180, 0.65 * 180]) == 234
    assert admission.capacity_of([0.18 * 10]) == 1
    # 제한 없는 프로세스가 하나라도 있으면 제한을 끈다
    assert admission.capacity_of([117.0, admission.UNLIMITED]) is None
    assert admission.capacity_of([]) is None


async def test_dead_process_share_drops_out(monkeypatch):
    store = admission.MemoryStore()
    monkeypatch.setattr(admission, "PROCESS_ID", "a")
    await store.publish_share(100.0)
    monkeypatch.setattr(admission, "PROCESS_ID", "b")
    await store.publish_share(50.0)
    assert (await store.snapshot()).capacity == 150
    # b만 계속 하트비트를 올리고 a는 멈췄다
    later = time.time() + admission.SHARE_STALE_AFTER + 1
    monkeypatch.setattr(admission.time, "time", lambda: later)
    await store.publish_share(50.0)
    assert (await store.snapshot()).capacity == 50
