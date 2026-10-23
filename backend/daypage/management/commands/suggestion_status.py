import sys

from django.core.management.base import BaseCommand, CommandError

from daypage import suggestions
from daypage.models import Suggestion


class Command(BaseCommand):
    help = "건의 상태를 바꾼다(건의 자동 처리 워커용). 검토 중·반영함이 되면 디스코드로 알린다."

    def add_arguments(self, parser):
        parser.add_argument("suggestion_id", type=int)
        parser.add_argument("status", choices=[c for c, _ in Suggestion.Status.choices])
        parser.add_argument("--note", default="", help="알림 끝에 붙일 한 줄(예: 반영한 PR). '-'면 표준 입력에서 읽는다")

    def handle(self, suggestion_id: int, status: str, note: str = "", **options):
        s = Suggestion.objects.filter(pk=suggestion_id).first()
        if s is None:
            raise CommandError(f"건의를 찾을 수 없어요: {suggestion_id}")
        if note == "-":
            note = sys.stdin.read()
        before = s.status
        if not suggestions.change_status(s, status, note):
            self.stdout.write(f"건의 #{s.id}는 이미 {s.get_status_display()}이에요(바꾸지 않음)")
            return
        self.stdout.write(f"건의 #{s.id}: {Suggestion.Status(before).label} → {s.get_status_display()}")
