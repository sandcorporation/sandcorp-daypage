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
