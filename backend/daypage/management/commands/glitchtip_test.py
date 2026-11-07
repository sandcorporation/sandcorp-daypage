"""GlitchTip 연동 확인: 시험 오류 하나를 보내고, 끝나기 전에 전송을 마친다.

운영에서 대장이 `docker exec daypage-backend-1 python manage.py glitchtip_test "연동 시험 daypage <날짜>"`로 돌린다.
예외 이름 `GlitchTipOnboardingTest`는 공용 precheck가 「시험」으로 알아본다(일부러 던지는 다른 예외 이름과 다르다).
"""

import sentry_sdk
from django.core.management.base import BaseCommand, CommandError, CommandParser


class GlitchTipOnboardingTest(Exception):
    """연동 시험으로 일부러 던지는 예외. before_send가 버리지 않는다(상태 코드가 없다)."""


class Command(BaseCommand):
    help = "GlitchTip에 시험 오류(GlitchTipOnboardingTest) 하나를 보내고 이벤트 id를 찍는다."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("message", nargs="?", default="연동 시험 daypage")

    def handle(self, *args: object, message: str, **options: object) -> None:
        if not sentry_sdk.is_initialized():
            raise CommandError("오류 수집이 꺼져 있다(SENTRY_DSN 없음 또는 DEBUG). 아무것도 보내지 않았다.")
        try:
            raise GlitchTipOnboardingTest(message)
        except GlitchTipOnboardingTest as exc:
            event_id = sentry_sdk.capture_exception(exc)
        # 명령이 끝나면 프로세스가 내려가므로, 그 전에 전송을 마친다.
        sentry_sdk.flush(timeout=10)
        if event_id is None:
            raise CommandError("이벤트가 만들어지지 않았다(before_send가 버렸거나 SDK가 거절).")
        client = sentry_sdk.get_client()
        self.stdout.write(
            f"GlitchTip 시험 이벤트 보냄: id={event_id} release={client.options.get('release')} "
            f"environment={client.options.get('environment')}"
        )
