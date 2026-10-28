"""운영자 권한 켜고 끄기: manage.py grant_staff <user id> [--off]

user id는 운영자 페이지 사용자 목록이나 /api/me를 부른 브라우저로는 알 수 없으므로,
처음 한 번은 --latest(가장 최근에 노트를 연 사람)나 --note <노트 id>(그 노트를 만든 사람)로 고른다.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Max

from daypage.models import Note, User


class Command(BaseCommand):
    help = "사용자에게 운영자 권한을 켠다(--off로 끈다)"

    def add_arguments(self, parser):
        parser.add_argument("user_id", nargs="?", type=int)
        parser.add_argument("--note", help="이 노트를 만든 사람. '-'로 시작하는 ID는 --note=ID 꼴로 쓴다")
        parser.add_argument("--latest", action="store_true", help="가장 최근에 노트를 연 사람")
        parser.add_argument("--off", action="store_true", help="권한을 끈다")

    def handle(self, user_id=None, note=None, latest=False, off=False, **_):
        if note:
            user = Note.objects.filter(pk=note).values_list("owner", flat=True).first()
            if user is None:
                raise CommandError("없는 노트예요")
            user_id = user
        elif latest:
            row = User.objects.annotate(v=Max("memberships__last_visited_at")).exclude(v=None).order_by("-v").first()
            if row is None:
                raise CommandError("노트를 연 사람이 없어요")
            user_id = row.id
        if user_id is None:
            raise CommandError("user id, --note, --latest 중 하나를 주세요")
        updated = User.objects.filter(pk=user_id).update(is_staff=not off)
        if not updated:
            raise CommandError(f"없는 사용자예요: {user_id}")
        self.stdout.write(f"사용자 {user_id}: 운영자 {'끔' if off else '켬'}")
