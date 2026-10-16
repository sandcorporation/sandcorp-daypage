import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent


def _load_dotenv(path: Path) -> None:
    """저장소 루트 .env를 읽어 비어 있는 환경 변수만 채운다."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(REPO_DIR / ".env")


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def env_bool(key: str, default: bool = False) -> bool:
    return env(key, str(default)).lower() in ("1", "true", "yes", "on")


SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-secret-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = [h for h in env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]
CSRF_TRUSTED_ORIGINS = [o for o in env("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5173").split(",") if o]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "channels",
    "daypage",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "daypage"),
        "USER": env("POSTGRES_USER", "daypage"),
        "PASSWORD": env("POSTGRES_PASSWORD", "daypage"),
        "HOST": env("POSTGRES_HOST", "127.0.0.1"),
        "PORT": env("POSTGRES_PORT", "5432"),
        # 연결을 재사용한다. 0(기본값)이면 웹소켓의 DB 작업마다 연결을 새로 열어
        # Postgres가 연결마다 프로세스를 띄우느라 CPU를 다 쓴다.
        "CONN_MAX_AGE": int(env("DB_CONN_MAX_AGE", "60")),
        "CONN_HEALTH_CHECKS": True,
    }
}

REDIS_URL = env("REDIS_URL", "redis://127.0.0.1:6379/0")

# 접속 중인 연결 목록(Presence·동시 접속 상한). 비우면 프로세스 메모리를 쓴다.
ROOM_REGISTRY_URL = env("ROOM_REGISTRY_URL", REDIS_URL)

# 증분이 이만큼 쌓이면 스냅샷으로 합친다.
COMPACT_EVERY = int(env("COMPACT_EVERY", "200"))

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        # redis-py 8의 기본 소켓 타임아웃(5초)이 channels_redis의 5초 BZPOPMIN 대기와 같아
        # 대기 중에 읽기 타임아웃이 나며 consumer가 죽는다. 대기보다 길게 잡는다.
        "CONFIG": {
            "hosts": [{"address": REDIS_URL, "socket_timeout": 30}],
            # 연결마다 쌓일 수 있는 메시지 수. 기본값(100)이면 부하 때 ChannelFull로 연결이 끊긴다.
            "capacity": 1000,
            # 프로세스 채널(daypage/hub.py)은 한 장이 여러 프로세스에 나뉘었을 때 그 장들의 편집·커서를
            # 모두 받는다. 편집이 버려지지 않게 넉넉히 둔다.
            "channel_capacity": {"daypage-hub.*": 20000},
        },
    }
}

AUTH_USER_MODEL = "daypage.User"

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

KAKAO_REST_API_KEY = env("KAKAO_REST_API_KEY")
KAKAO_CLIENT_SECRET = env("KAKAO_CLIENT_SECRET") or env("KAKAO_CLIENT_SECRET_KEY")
KAKAO_REDIRECT_URI = env("KAKAO_REDIRECT_URI", "http://localhost:5173/auth/kakao/callback")

# 노트 화면에서 공유 링크를 만들 때 쓰는 공개 주소
# 로컬 수동 확인용 로그인(/auth/dev-login). DEBUG일 때만 켤 수 있다.
DEV_LOGIN = DEBUG and env_bool("DJANGO_DEV_LOGIN", False)

PUBLIC_ORIGIN = env("PUBLIC_ORIGIN", "http://localhost:5173")

# 노트당 동시 접속 상한(서버 보호용, 정원과 별개)
MAX_CONCURRENT_PER_NOTE = int(env("MAX_CONCURRENT_PER_NOTE", "20"))

# 수용 인원(서비스 전체 실시간 접속 상한) = 백엔드 프로세스마다 CPU 제한(cgroup cpu.max) × 코어당 인원의 합.
# CPU 제한이 없는 프로세스가 하나라도 있으면(로컬·테스트) 제한을 끈다.
MAX_ONLINE_PER_CORE = float(env("MAX_ONLINE_PER_CORE", "180"))
CGROUP_CPU_MAX_PATH = env("CGROUP_CPU_MAX_PATH", "/sys/fs/cgroup/cpu.max")
# 대기자가 있을 때 이만큼(초) 편집·커서 입력이 없는 사람부터 내보낸다.
AWAY_AFTER = float(env("AWAY_AFTER", "600"))
# 대기자에게 순번을 다시 알리고 입장을 다시 판정하는 간격(초)
QUEUE_POLL_EVERY = float(env("QUEUE_POLL_EVERY", "2"))

CELERY_BROKER_URL = REDIS_URL
CELERY_TIMEZONE = "Asia/Seoul"
CELERY_ENABLE_UTC = False

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}

# 오류 수집(GlitchTip). DSN이 있고 DEBUG가 꺼진 운영에서만 켠다.
from .sentry import init_sentry  # noqa: E402

SENTRY_ENVIRONMENT = env("SENTRY_ENVIRONMENT", "production")
SENTRY_ENABLED = init_sentry(env("SENTRY_DSN"), debug=DEBUG, environment=SENTRY_ENVIRONMENT)
# 프론트 오류 수집 DSN(/api/client-config로 내려준다). 백엔드와 같이 운영에서만 준다.
SENTRY_FRONTEND_DSN = "" if DEBUG else env("SENTRY_FRONTEND_DSN")
