import datetime as dt

import pytest
from asgiref.sync import sync_to_async
from django.test import Client

from daypage import clock
from daypage.models import Note, NoteMember, Page, PageUpdate
from tests.helpers import create_note, login_as


@pytest.mark.django_db
def test_owner_deletes_note_with_members_and_everything_goes():
    owner = login_as(1)
    note_id = create_note(owner, name="지울 노트")
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    page = Page.objects.create(note_id=note_id, date=dt.date(2026, 10, 14))
    PageUpdate.objects.create(page=page, update=b"\x00\x00")

    res = owner.delete(f"/api/notes/{note_id}")
    assert res.status_code == 204
    assert not Note.objects.filter(pk=note_id).exists()
    assert not NoteMember.objects.filter(note_id=note_id).exists()
    assert not Page.objects.filter(note_id=note_id).exists()
    assert not PageUpdate.objects.filter(page__note_id=note_id).exists()
    # 참여자도 더는 볼 수 없다
    assert guest.get(f"/api/notes/{note_id}").status_code == 404
    assert Client().get(f"/api/notes/{note_id}/preview").status_code == 404
    assert guest.get("/api/me").json()["notes"] == []


@pytest.mark.django_db
def test_member_who_is_not_owner_cannot_delete():
    owner = login_as(1)
    note_id = create_note(owner)
    guest = login_as(2)
    guest.get(f"/api/notes/{note_id}")
    assert guest.delete(f"/api/notes/{note_id}").status_code == 403
    assert Note.objects.filter(pk=note_id).exists()


@pytest.mark.django_db
def test_delete_requires_login_and_unknown_note_is_404():
    owner = login_as(1)
    note_id = create_note(owner)
    assert Client().delete(f"/api/notes/{note_id}").status_code == 401
    assert owner.delete("/api/notes/nope").status_code == 404


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_people_in_the_note_are_disconnected_when_it_is_deleted(monkeypatch):
    from tests.ws import expect_close, join

    monkeypatch.setattr(clock, "now", lambda: dt.datetime(2026, 10, 15, 15, 0, tzinfo=clock.KST))
    owner = await sync_to_async(login_as)(1)
    note_id = await sync_to_async(create_note)(owner)
    guest = await sync_to_async(login_as)(2)
    await sync_to_async(guest.get)(f"/api/notes/{note_id}")
    y = await join(guest, note_id, "2026-10-15")

    res = await sync_to_async(owner.delete)(f"/api/notes/{note_id}")
    assert res.status_code == 204
    assert await expect_close(y.ws) == 4404
