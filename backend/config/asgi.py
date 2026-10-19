import os

from django.core.asgi import get_asgi_application

from config.logfilters import install_access_log_filter

install_access_log_filter()

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
from sentry_sdk.integrations.asgi import SentryAsgiMiddleware  # noqa: E402

from daypage.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        # 세션 쿠키로 인증하므로 다른 사이트에서 연 웹소켓(Origin 불일치)은 막는다.
        # http는 Django 연동이 오류를 잡고, 웹소켓은 이 미들웨어가 잡는다(Sentry가 꺼져 있으면 아무 일도 안 한다).
        "websocket": SentryAsgiMiddleware(
            AllowedHostsOriginValidator(AuthMiddlewareStack(URLRouter(websocket_urlpatterns)))
        ),
    }
)
