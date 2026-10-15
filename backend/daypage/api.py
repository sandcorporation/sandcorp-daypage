from django.middleware.csrf import get_token
from ninja import NinjaAPI

api = NinjaAPI(title="Daypage API", urls_namespace="api")


@api.get("/health")
def health(request):
    return {"ok": True}


@api.get("/me")
def me(request):
    # SPA가 POST 요청에 쓸 CSRF 쿠키를 여기서 내려준다.
    get_token(request)
    if not request.user.is_authenticated:
        return {"authenticated": False, "notes": []}
    return {"authenticated": True, "notes": []}
