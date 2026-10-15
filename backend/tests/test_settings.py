from django.conf import settings as django_settings


def test_channel_layer_socket_timeout_outlasts_blocking_receive():
    """channels_redis는 5초 BZPOPMIN으로 기다리므로 소켓 타임아웃이 그보다 길어야 한다."""
    from channels_redis.core import RedisChannelLayer

    from config import settings as project_settings

    host = project_settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0]
    assert host["socket_timeout"] is None or host["socket_timeout"] > RedisChannelLayer.brpop_timeout
    assert django_settings.ROOT_URLCONF == "config.urls"
