from django.conf import settings as django_settings


def test_channel_layer_socket_timeout_outlasts_blocking_receive():
    """channels_redis는 5초 BZPOPMIN으로 기다리므로 소켓 타임아웃이 그보다 길어야 한다."""
    from channels_redis.core import RedisChannelLayer

    from config import settings as project_settings

    host = project_settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0]
    assert host["socket_timeout"] is None or host["socket_timeout"] > RedisChannelLayer.brpop_timeout
    assert django_settings.ROOT_URLCONF == "config.urls"


def test_channel_layer_has_room_for_bursts():
    """연결마다 쌓이는 메시지 한도가 작으면 부하 때 ChannelFull로 연결이 끊긴다."""
    from config import settings as project_settings

    assert project_settings.CHANNEL_LAYERS["default"]["CONFIG"]["capacity"] >= 1000


def test_process_channel_has_more_room_than_a_connection():
    """프로세스 채널(hub)은 나뉜 장 여러 개의 편집을 함께 받으므로 연결 한도보다 넉넉해야 한다."""
    from channels_redis.core import RedisChannelLayer

    from config import settings as project_settings

    config = project_settings.CHANNEL_LAYERS["default"]["CONFIG"]
    layer = RedisChannelLayer(**config)
    hub_channel = "daypage-hub.abc!def"  # new_channel("daypage-hub")가 만드는 모양
    assert layer.get_capacity(hub_channel) >= 10000
    assert layer.get_capacity("specific.abc!def") == config["capacity"]


def test_database_connections_are_reused():
    """웹소켓 DB 작업마다 연결을 새로 열면 Postgres가 연결 생성에 CPU를 다 쓴다."""
    from config import settings as project_settings

    assert project_settings.DATABASES["default"]["CONN_MAX_AGE"] >= 30
