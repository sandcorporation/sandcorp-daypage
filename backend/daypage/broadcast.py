"""접속자에게 보내는 실시간 알림(channel layer 그룹). 장 방(hub.py) 밖의 알림은 모두 여기로 보낸다.

알림은 저장에 딸린 일이다. 알림 서버가 멈춰 보내지 못해도 이미 저장한 동작(과 다른 알림)은 실패시키지 않고
예외와 함께 오류 로그로 남긴다(오류 수집에 잡힌다). 실패한 알림은 다시 보내지 않는다.
"""

import logging
from collections.abc import Mapping

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

logger = logging.getLogger(__name__)


def send_now(group: str, event: Mapping[str, object]) -> None:
    try:
        async_to_sync(get_channel_layer().group_send)(group, event)
    except Exception:
        logger.exception("실시간 알림(%s)을 %s에 보내지 못했어요", event["type"], group)


def send_after_commit(group: str, event: Mapping[str, object]) -> None:
    """지금 트랜잭션이 저장된 뒤 보낸다(트랜잭션 밖이면 바로)."""
    transaction.on_commit(lambda: send_now(group, event))
