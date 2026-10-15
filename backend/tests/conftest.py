import pytest


@pytest.fixture(autouse=True)
def _test_settings(settings):
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    settings.KAKAO_REST_API_KEY = "test-rest-key"
    settings.KAKAO_CLIENT_SECRET = "test-secret"
    settings.KAKAO_REDIRECT_URI = "http://testserver/auth/kakao/callback"
