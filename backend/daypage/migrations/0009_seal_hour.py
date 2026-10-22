"""노트마다 봉인 시각. 장에 기간(opened_at·due_at)과 같은 날짜 안 순번(seq)을 둔다.

기존 장은 모두 자정 기준이었으므로 opened_at = 날짜 00:00 KST, due_at = 다음 날 00:00 KST, seq = 1로 채운다.
"""

from django.db import migrations, models

# 날짜(KST 자정)를 timestamptz로: 장이 많아도 UPDATE 한 번
FILL_PERIODS = """
UPDATE daypage_page
SET opened_at = (date::timestamp AT TIME ZONE 'Asia/Seoul'),
    due_at = (date::timestamp AT TIME ZONE 'Asia/Seoul') + interval '1 day'
"""


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
        migrations.RunSQL(FILL_PERIODS, migrations.RunSQL.noop),
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
