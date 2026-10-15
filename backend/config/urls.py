from django.urls import path

from daypage.api import api

urlpatterns = [
    path("api/", api.urls),
]
