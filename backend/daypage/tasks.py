from celery import shared_task

from .sealing import seal_and_announce


@shared_task
def seal_pages() -> int:
    """지난 장을 봉인하고 접속자에게 자정 교체를 알린다."""
    return seal_and_announce()
