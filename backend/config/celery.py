import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("daypage")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# 매시 정각 실행: 00:00(KST)에 어제 장을 봉인하고, 서버가 꺼져 있어 놓친 장도 다음 정각에 따라잡는다.
app.conf.beat_schedule = {
    "seal-pages": {"task": "daypage.tasks.seal_pages", "schedule": crontab(minute=0)},
    # 생존 신호(daypage/health.py). 워커가 죽은 동안 쌓인 것은 15초 뒤 버려 다시 떴을 때 몰아 돌지 않는다.
    "heartbeat": {"task": "daypage.tasks.heartbeat", "schedule": 15.0, "options": {"expires": 15}},
}
