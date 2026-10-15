import logging
import secrets

from django.contrib.auth import login, logout
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseRedirect
from django.views.decorators.http import require_GET, require_POST

from . import kakao
from .models import User

logger = logging.getLogger(__name__)

SESSION_KEY = "kakao_oauth"


def safe_next(value: str | None) -> str:
    """같은 사이트의 상대 경로만 허용한다(open redirect 방지)."""
    if not value or not value.startswith("/") or value.startswith("//") or value.startswith("/\\"):
        return "/"
    if any(ch in value for ch in "\r\n\t"):
        return "/"
    return value


@require_GET
def kakao_login(request):
    state = secrets.token_urlsafe(24)
    request.session[SESSION_KEY] = {"state": state, "next": safe_next(request.GET.get("next"))}
    return HttpResponseRedirect(kakao.authorize_url(state))


@require_GET
def kakao_callback(request):
    pending = request.session.pop(SESSION_KEY, None)
    state = request.GET.get("state")
    if not pending or not state or not secrets.compare_digest(pending["state"], state):
        return HttpResponseBadRequest("로그인 요청이 올바르지 않아요. 처음부터 다시 시도해 주세요.")

    next_path = pending["next"]
    if request.GET.get("error"):
        # 사용자가 동의 화면에서 취소한 경우: 로그인 없이 원래 자리로 돌려보낸다.
        return HttpResponseRedirect(next_path)

    code = request.GET.get("code")
    if not code:
        return HttpResponseBadRequest("인가 코드가 없어요.")

    try:
        kakao_id = kakao.fetch_kakao_id(code)
    except kakao.KakaoError:
        logger.exception("카카오 로그인 실패")
        return HttpResponse("카카오 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.", status=502)

    user = User.objects.get_or_create_kakao(kakao_id)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return HttpResponseRedirect(next_path)


@require_POST
def logout_view(request):
    logout(request)
    return HttpResponse(status=204)


@require_GET
def dev_login(request):
    """로컬 수동 확인용 로그인. DEBUG와 DEV_LOGIN이 모두 켜졌을 때만 동작한다."""
    from django.conf import settings
    from django.http import Http404

    if not (settings.DEBUG and settings.DEV_LOGIN):
        raise Http404
    user = User.objects.get_or_create_kakao(int(request.GET.get("kakao_id", "1")))
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return HttpResponseRedirect(safe_next(request.GET.get("next")))
