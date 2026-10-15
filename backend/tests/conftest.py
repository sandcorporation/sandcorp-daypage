import pytest

from daypage import admission, rooms


@pytest.fixture(autouse=True)
def _test_settings(settings):
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    settings.ROOM_REGISTRY_URL = None
    settings.KAKAO_REST_API_KEY = "test-rest-key"
    settings.KAKAO_CLIENT_SECRET = "test-secret"
    settings.KAKAO_REDIRECT_URI = "http://testserver/auth/kakao/callback"
    settings.ALLOWED_HOSTS = ["localhost", "testserver"]
    # 이 컴퓨터의 cgroup과 상관없이 수용 인원 제한을 끈다(test_capacity가 따로 켠다).
    settings.CGROUP_CPU_MAX_PATH = "/nonexistent/cpu.max"
    rooms.reset_registry()
    admission.reset_store()
    yield
    rooms.reset_registry()
    admission.reset_store()
