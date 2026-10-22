"""노트마다 봉인 시각. 장에 기간(opened_at·due_at)과 같은 날짜 안 순번(seq)을 둔다.

기존 장은 모두 자정 기준이었으므로 opened_at = 날짜 00:00 KST, due_at = 다음 날 00:00 KST, seq = 1로 채운다.
"""

import datetime as dt
from zoneinfo import ZoneInfo

from django.db import migrations, models

KST = ZoneInfo("Asia/Seoul")


def fill_periods(apps, schema_editor):
    Page = apps.get_model("daypage", "Page")
    for page in Page.objects.all().only("id", "date"):
        start = dt.datetime.combine(page.date, dt.time.min, tzinfo=KST)
        Page.objects.filter(pk=page.pk).update(opened_at=start, due_at=start + dt.timedelta(days=1))


class Migration(migrations.Migration):
    dependencies = [("daypage", "0008_moderation")]

    operations = [
        migrations.AddField(
            model_name="note",
            name="seal_hour",
            field=models.PositiveSmallIntegerField(default=0, db_default=0),
        ),
        migrations.AddField(
            model_name="page",
            name="seq",
            field=models.PositiveSmallIntegerField(default=1, db_default=1),
        ),
        migrations.AddField(model_name="page", name="opened_at", field=models.DateTimeField(null=True)),
        migrations.AddField(model_name="page", name="due_at", field=models.DateTimeField(null=True)),
        migrations.RunPython(fill_periods, migrations.RunPython.noop),
        migrations.AlterField(model_name="page", name="opened_at", field=models.DateTimeField()),
        migrations.AlterField(model_name="page", name="due_at", field=models.DateTimeField()),
        migrations.RemoveConstraint(model_name="page", name="uniq_page_note_date"),
        migrations.AddConstraint(
            model_name="page",
            constraint=models.UniqueConstraint(fields=["note", "date", "seq"], name="uniq_page_note_date_seq"),
        ),
        migrations.RemoveIndex(model_name="page", name="daypage_pag_sealed__028469_idx"),
        migrations.AddIndex(
            model_name="page",
            index=models.Index(fields=["sealed_at", "due_at"], name="daypage_pag_sealed__27c8f3_idx"),
        ),
    ]
