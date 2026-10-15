from django.urls import path

from daypage import auth_views
from daypage.api import api

urlpatterns = [
    path("api/", api.urls),
    path("auth/kakao/login", auth_views.kakao_login),
    path("auth/kakao/callback", auth_views.kakao_callback),
    path("auth/logout", auth_views.logout_view),
    path("auth/dev-login", auth_views.dev_login),
]
