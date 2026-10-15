from django.core.management.base import BaseCommand

from daypage.sealing import seal_and_announce


class Command(BaseCommand):
    help = "오늘(KST) 이전의 봉인 안 된 장을 봉인하고 자정 교체를 알린다."

    def handle(self, *args, **options):
        count = seal_and_announce()
        self.stdout.write(f"장 {count}개 봉인")
