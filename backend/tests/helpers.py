from django.test import Client

from daypage.models import User


def login_as(kakao_id: int) -> Client:
    """해당 회원번호로 로그인된 테스트 클라이언트를 만든다."""
    client = Client()
    user = User.objects.get_or_create_kakao(kakao_id)
    client.force_login(user, backend="django.contrib.auth.backends.ModelBackend")
    return client


def create_note(client: Client, **body) -> str:
    res = client.post("/api/notes", body, content_type="application/json")
    assert res.status_code == 200, res.content
    return res.json()["id"]
