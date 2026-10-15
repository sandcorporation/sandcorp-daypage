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
}
