"""카카오 OAuth 2.0 인가 코드 방식. 동의 항목 없이 회원번호만 쓴다."""

from urllib.parse import urlencode

import httpx
from django.conf import settings

AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"
TOKEN_URL = "https://kauth.kakao.com/oauth/token"
USER_URL = "https://kapi.kakao.com/v2/user/me"


class KakaoError(Exception):
    pass


def authorize_url(state: str) -> str:
    params = {
        "client_id": settings.KAKAO_REST_API_KEY,
        "redirect_uri": settings.KAKAO_REDIRECT_URI,
        "response_type": "code",
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def fetch_kakao_id(code: str) -> int:
    """인가 코드를 토큰으로 바꾸고 그 토큰으로 회원번호를 조회한다."""
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.KAKAO_REST_API_KEY,
        "redirect_uri": settings.KAKAO_REDIRECT_URI,
        "code": code,
    }
    if settings.KAKAO_CLIENT_SECRET:
        data["client_secret"] = settings.KAKAO_CLIENT_SECRET
    try:
        with httpx.Client(timeout=10) as http:
            token_res = http.post(TOKEN_URL, data=data)
            if token_res.status_code != 200:
                raise KakaoError(f"token exchange failed: {token_res.status_code} {token_res.text}")
            access_token = token_res.json()["access_token"]
            user_res = http.get(USER_URL, headers={"Authorization": f"Bearer {access_token}"})
            if user_res.status_code != 200:
                raise KakaoError(f"user lookup failed: {user_res.status_code} {user_res.text}")
            return int(user_res.json()["id"])
    except httpx.HTTPError as exc:
        raise KakaoError(str(exc)) from exc
