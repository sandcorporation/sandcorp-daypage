from celery import shared_task

from . import health
from .sealing import seal_and_announce


@shared_task(ignore_result=True)
def send_suggestion_alert(suggestion_id: int, event: str, note: str = "") -> None:
    """건의 알림을 디스코드와 둘째 알림 목적지로 보낸다(daypage/suggestions.py)."""
    from .suggestions import send

    send(suggestion_id, event, note)


@shared_task
def seal_pages() -> int:
    """지난 장을 봉인하고 접속자에게 자정 교체를 알린다."""
    return seal_and_announce()


@shared_task(ignore_result=True)
def heartbeat() -> None:
    """beat가 15초마다 내고 worker가 실행해 생존 신호 키를 갱신한다(/api/health의 worker 점검)."""
    health.beat()
