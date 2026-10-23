from celery import shared_task

from .sealing import seal_and_announce


@shared_task(ignore_result=True)
def send_suggestion_alert(suggestion_id: int, event: str, note: str = "") -> None:
    """건의 알림을 디스코드로 보낸다(daypage/suggestions.py)."""
    from .suggestions import send

    send(suggestion_id, event, note)


@shared_task
def seal_pages() -> int:
    """지난 장을 봉인하고 접속자에게 자정 교체를 알린다."""
    return seal_and_announce()
