# 노트 머리말 알림의 판(#222). 표에 열을 더하지 않고 시퀀스 하나만 만든다(옛 백엔드는 쓰지 않는다).

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('daypage', '0012_suggestion_context'),
    ]

    operations = [
        migrations.RunSQL(
            "CREATE SEQUENCE IF NOT EXISTS daypage_note_info_seq",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
