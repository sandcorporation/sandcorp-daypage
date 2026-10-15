import pytest

from daypage import rooms


@pytest.fixture(autouse=True)
def _test_settings(settings):
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    settings.ROOM_REGISTRY_URL = None
    settings.KAKAO_REST_API_KEY = "test-rest-key"
    settings.KAKAO_CLIENT_SECRET = "test-secret"
    settings.KAKAO_REDIRECT_URI = "http://testserver/auth/kakao/callback"
    settings.ALLOWED_HOSTS = ["localhost", "testserver"]
    rooms.reset_registry()
    yield
    rooms.reset_registry()
