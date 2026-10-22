from django.urls import re_path

from .consumers import PageConsumer

websocket_urlpatterns = [
    re_path(r"^ws/notes/(?P<note_id>[A-Za-z0-9_-]+)/pages/(?P<key>[0-9-]+)$", PageConsumer.as_asgi()),
]
