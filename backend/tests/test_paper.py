"""노트 종이(모양·여백 선·색): 노트 전체 설정, 참여자 누구나 바꾸고, 봉인한 장에는 그날 종이가 남는다."""

import datetime as dt

import pytest
from django.test import Client

from daypage import clock
from daypage.models import Note, Page
from daypage.sealing import seal_page
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db

DEFAULT = {"pattern": "lined", "margin": True, "color": "white"}


def test_new_note_has_the_default_lined_paper():
    client = login_as(1)
    note_id = create_note(client)
    assert client.get(f"/api/notes/{note_id}").json()["paper"] == DEFAULT


def test_any_member_changes_the_paper_for_everyone():
    owner = login_as(1)
    note_id = create_note(owner)
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    res = guest.patch(f"/api/notes/{note_id}/paper", {"pattern": "dot", "color": "cream"}, content_type="application/json")
    assert res.status_code == 200
    assert res.json() == {"pattern": "dot", "margin": True, "color": "cream"}
    # 만든 사람 화면(다음에 읽을 때)도 같은 종이
    assert owner.get(f"/api/notes/{note_id}").json()["paper"] == {"pattern": "dot", "margin": True, "color": "cream"}
    res = owner.patch(f"/api/notes/{note_id}/paper", {"margin": False}, content_type="application/json")
    assert res.json() == {"pattern": "dot", "margin": False, "color": "cream"}


def test_only_members_change_the_paper_and_values_are_checked():
    owner = login_as(1)
    note_id = create_note(owner)
    stranger = login_as(3)
    assert stranger.patch(f"/api/notes/{note_id}/paper", {"pattern": "dot"}, content_type="application/json").status_code == 403
    assert Client().patch(f"/api/notes/{note_id}/paper", {"pattern": "dot"}, content_type="application/json").status_code == 401
    assert owner.patch(f"/api/notes/{note_id}/paper", {"pattern": "stars"}, content_type="application/json").status_code == 422
    assert owner.patch(f"/api/notes/{note_id}/paper", {"color": "pink"}, content_type="application/json").status_code == 422


def test_sealed_page_keeps_the_paper_of_its_day():
    owner = login_as(1)
    note_id = create_note(owner)
    note = Note.objects.get(pk=note_id)
    yesterday = clock.today_kst() - dt.timedelta(days=1)
    page = Page.objects.create(note=note, date=yesterday, is_empty=False)
    owner.patch(f"/api/notes/{note_id}/paper", {"pattern": "grid"}, content_type="application/json")
    seal_page(page.id)
    Page.objects.filter(pk=page.id).update(is_empty=False)
    # 봉인 뒤에 노트 종이를 바꿔도 지난 장은 그날 종이 그대로
    owner.patch(f"/api/notes/{note_id}/paper", {"pattern": "blank"}, content_type="application/json")
    listed = owner.get(f"/api/notes/{note_id}/pages").json()
    assert listed[0]["paper"]["pattern"] == "grid"


def test_old_sealed_page_without_paper_shows_the_default():
    owner = login_as(1)
    note_id = create_note(owner)
    note = Note.objects.get(pk=note_id)
    Page.objects.create(note=note, date=clock.today_kst() - dt.timedelta(days=2), is_empty=False, sealed_at=clock.now())
    assert owner.get(f"/api/notes/{note_id}/pages").json()[0]["paper"] == DEFAULT


def test_custom_paper_color_is_a_hex_code():
    owner = login_as(1)
    note_id = create_note(owner)
    res = owner.patch(f"/api/notes/{note_id}/paper", {"color": "#FDE8EF"}, content_type="application/json")
    assert res.status_code == 200
    assert res.json()["color"] == "#fde8ef"
    assert owner.get(f"/api/notes/{note_id}").json()["paper"]["color"] == "#fde8ef"
    for bad in ("#fde8e", "fde8ef", "#gggggg", "chalk"):
        assert owner.patch(f"/api/notes/{note_id}/paper", {"color": bad}, content_type="application/json").status_code == 422


def test_removed_chalk_paper_falls_back_to_white():
    owner = login_as(1)
    note_id = create_note(owner)
    Note.objects.filter(pk=note_id).update(paper={"pattern": "dot", "margin": False, "color": "chalk"})
    assert owner.get(f"/api/notes/{note_id}").json()["paper"] == {"pattern": "dot", "margin": False, "color": "white"}
