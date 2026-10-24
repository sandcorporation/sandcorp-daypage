import pytest
from django.test import Client

from tests.helpers import login_as

pytestmark = pytest.mark.django_db


def put(client, body):
    return client.put("/api/me/shortcuts", body, content_type="application/json")


def test_saved_shortcuts_follow_the_user_to_another_device():
    assert login_as(1).get("/api/me/shortcuts").json() == {}
    res = put(login_as(1), {"eraser": ["P"], "pen": [], "redo": ["Mod+Shift+Z", "Mod+Y"]})
    assert res.status_code == 200
    # 같은 사람의 다른 기기(새 세션)
    assert login_as(1).get("/api/me/shortcuts").json() == {"eraser": ["P"], "pen": [], "redo": ["Mod+Shift+Z", "Mod+Y"]}
    # 다른 사람은 기본값
    assert login_as(2).get("/api/me/shortcuts").json() == {}
    # 통째로 바꾼다: 빈 {}이면 모두 기본값
    put(login_as(1), {})
    assert login_as(1).get("/api/me/shortcuts").json() == {}


def test_shortcut_values_are_checked():
    client = login_as(1)
    for bad in [
        {"nope": ["X"]},
        {"pen": ["Escape"]},
        {"pen": ["Ctrl+P"]},
        {"pen": "P"},
        {"pen": ["P"], "eraser": ["P"]},
        {"pen": ["A", "B", "C", "D", "E"]},
        ["P"],
    ]:
        assert put(client, bad).status_code == 422, bad
    assert client.put("/api/me/shortcuts", "{", content_type="application/json").status_code == 422
    assert client.get("/api/me/shortcuts").json() == {}


def test_shortcuts_need_login():
    assert Client().get("/api/me/shortcuts").status_code == 401
    assert Client().put("/api/me/shortcuts", {}, content_type="application/json").status_code == 401
