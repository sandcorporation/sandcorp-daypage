"""시간 기준. 테스트에서 `clock.now`를 바꿔 자정 경계를 재현한다."""

import datetime as dt
from zoneinfo import ZoneInfo

from django.utils import timezone

KST = ZoneInfo("Asia/Seoul")


def now() -> dt.datetime:
    return timezone.now()


def today_kst() -> dt.date:
    return now().astimezone(KST).date()


def kst_date_of(moment: dt.datetime) -> dt.date:
    return moment.astimezone(KST).date()


def next_midnight_kst() -> dt.datetime:
    tomorrow = today_kst() + dt.timedelta(days=1)
    return dt.datetime.combine(tomorrow, dt.time.min, tzinfo=KST)


def boundary_before(moment: dt.datetime, seal_hour: int) -> dt.datetime:
    """moment 이전(같은 순간 포함)의 가장 최근 하루 경계(KST의 seal_hour 정각). 노트의 하루는 여기서 시작한다."""
    local = moment.astimezone(KST)
    boundary = local.replace(hour=seal_hour, minute=0, second=0, microsecond=0)
    if boundary > local:
        boundary -= dt.timedelta(days=1)
    return boundary


def boundary_after(moment: dt.datetime, seal_hour: int) -> dt.datetime:
    """moment 뒤에 처음 오는 하루 경계(moment가 경계 정각이면 다음 날)."""
    return boundary_before(moment, seal_hour) + dt.timedelta(days=1)
