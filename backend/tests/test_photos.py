"""사진: 줄인 사진을 오브젝트 저장소에 올리고, 장 문서에는 id와 자리만 둔다. 봉인할 때 남지 않은 사진은 지운다."""

import datetime as dt

import pytest
from pycrdt import Doc, Map

from daypage import clock, photos
from daypage.models import Note, Page, PageUpdate, Photo
from daypage.pages import get_or_create_page
from daypage.sealing import seal_due_pages
from tests.helpers import create_note, login_as

pytestmark = pytest.mark.django_db

WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 100
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 100


@pytest.fixture(autouse=True)
def store(settings):
    settings.PHOTO_S3_ENDPOINT = "https://ns.compat.objectstorage.us-example-1.oraclecloud.com"
    settings.PHOTO_S3_BUCKET = "daypage-photos"
    settings.PHOTO_S3_ACCESS_KEY = "key"
    settings.PHOTO_S3_SECRET_KEY = "secret"
    s = photos.MemoryStore()
    photos.set_store(s)
    yield s
    photos.set_store(None)


def upload(client, note_id, data=WEBP):
    return client.post(f"/api/notes/{note_id}/photos", data, content_type="application/octet-stream")


def kst(*args) -> dt.datetime:
    return dt.datetime(*args, tzinfo=clock.KST)


def test_member_uploads_photo_and_reads_it_back(store):
    owner = login_as(1)
    note_id = create_note(owner)
    res = upload(owner, note_id)
    assert res.status_code == 200
    photo_id = res.json()["id"]
    assert store.objects[f"notes/{note_id}/{photo_id}"] == (WEBP, "image/webp")
    got = owner.get(f"/api/notes/{note_id}/photos/{photo_id}")
    assert got.status_code == 200
    assert got["Content-Type"] == "image/webp"
    assert got.content == WEBP
    assert "immutable" in got["Cache-Control"]


def test_jpeg_is_accepted_by_its_bytes():
    owner = login_as(1)
    note_id = create_note(owner)
    assert upload(owner, note_id, JPEG).status_code == 200
    assert Photo.objects.get().mime == "image/jpeg"


def test_non_member_cannot_upload_or_read():
    owner = login_as(1)
    note_id = create_note(owner)
    photo_id = upload(owner, note_id).json()["id"]
    stranger = login_as(2)
    assert upload(stranger, note_id).status_code == 403
    assert stranger.get(f"/api/notes/{note_id}/photos/{photo_id}").status_code == 403


def test_photo_of_another_note_is_not_found():
    owner = login_as(1)
    a = create_note(owner)
    b = create_note(owner)
    photo_id = upload(owner, a).json()["id"]
    assert owner.get(f"/api/notes/{b}/photos/{photo_id}").status_code == 404


def test_too_big_photo_is_refused(store):
    owner = login_as(1)
    note_id = create_note(owner)
    res = upload(owner, note_id, WEBP + b"\x00" * photos.PHOTO_MAX_BYTES)
    assert res.status_code == 413
    assert store.objects == {}


def test_non_image_is_refused():
    owner = login_as(1)
    note_id = create_note(owner)
    res = upload(owner, note_id, b"<svg onload=alert(1)>")
    assert res.status_code == 400
    assert res.json()["code"] == "bad_photo"
    assert Photo.objects.count() == 0


def test_uploads_per_page_are_limited():
    owner = login_as(1)
    note_id = create_note(owner)
    for _ in range(photos.UPLOADS_PER_PAGE):
        assert upload(owner, note_id).status_code == 200
    res = upload(owner, note_id)
    assert res.status_code == 429
    assert res.json()["code"] == "photos_full"


def test_upload_is_off_without_storage(settings):
    photos.set_store(None)
    settings.PHOTO_S3_BUCKET = ""
    owner = login_as(1)
    note_id = create_note(owner)
    assert upload(owner, note_id).status_code == 503
    assert owner.get("/api/client-config").json()["photos"] is False


def test_client_config_says_photos_are_on():
    assert login_as(1).get("/api/client-config").json()["photos"] is True


def test_failed_store_leaves_no_row(store, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(store, "put", boom)
    owner = login_as(1)
    note_id = create_note(owner)
    assert upload(owner, note_id).status_code == 502
    assert Photo.objects.count() == 0


def test_deleting_note_removes_its_photos(store, django_capture_on_commit_callbacks):
    owner = login_as(1)
    note_id = create_note(owner)
    upload(owner, note_id)
    with django_capture_on_commit_callbacks(execute=True):
        assert owner.delete(f"/api/notes/{note_id}").status_code == 204
    assert store.objects == {}


def photo_doc(entries: dict[str, tuple[str, int]]) -> bytes:
    """{맵 key: (src, createdAt)}"""
    doc = Doc()
    m = doc.get("photos", type=Map)
    for key, (src, created) in entries.items():
        m[key] = Map({"src": src, "createdAt": created, "author": "졸린 수달", "x": 0, "y": 0, "width": 100, "height": 100})
    return doc.get_update()


def test_sealing_keeps_visible_photos_and_removes_the_rest(store, monkeypatch, django_capture_on_commit_callbacks):
    owner = login_as(1)
    note_id = create_note(owner)
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 15, 12, 0))
    ids = [upload(owner, note_id).json()["id"] for _ in range(5)]
    page = Page.objects.get(note_id=note_id)
    # 넷을 붙였고(하나는 동시에 붙여 한도를 넘었다), 하나는 올렸다가 뺐다
    PageUpdate.objects.create(page=page, update=photo_doc({f"p{i}": (ids[i], i) for i in range(4)}))
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 16, 0, 0, 5))
    with django_capture_on_commit_callbacks(execute=True):
        seal_due_pages()
    page.refresh_from_db()
    doc = Doc()
    doc.apply_update(bytes(page.state))
    assert sorted(doc.get("photos", type=Map).keys()) == ["p0", "p1", "p2"]
    assert set(Photo.objects.values_list("id", flat=True)) == set(ids[:3])
    assert set(store.objects) == {f"notes/{note_id}/{i}" for i in ids[:3]}
    assert (page.is_empty, page.participant_count) == (False, 1)


def test_page_with_only_a_photo_is_not_empty(monkeypatch):
    owner = login_as(1)
    note_id = create_note(owner)
    page = get_or_create_page(Note.objects.get(pk=note_id), dt.date(2026, 10, 15))
    pid = Photo.objects.create(id="a" * 32, note_id=note_id, page=page, mime="image/webp", size=10).id
    PageUpdate.objects.create(page=page, update=photo_doc({"p": (pid, 1)}))
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 16, 0, 0, 5))
    seal_due_pages()
    page.refresh_from_db()
    assert page.is_empty is False


def test_sealing_drops_photo_unknown_to_the_note(monkeypatch):
    owner = login_as(1)
    note_id = create_note(owner)
    page = get_or_create_page(Note.objects.get(pk=note_id), dt.date(2026, 10, 15))
    PageUpdate.objects.create(page=page, update=photo_doc({"p": ("f" * 32, 1)}))
    monkeypatch.setattr(clock, "now", lambda: kst(2026, 10, 16, 0, 0, 5))
    seal_due_pages()
    page.refresh_from_db()
    doc = Doc()
    doc.apply_update(bytes(page.state))
    assert len(doc.get("photos", type=Map)) == 0
    assert page.is_empty is True


def test_staff_can_read_photo_without_joining():
    from daypage.models import User

    owner = login_as(1)
    note_id = create_note(owner)
    photo_id = upload(owner, note_id).json()["id"]
    staff = login_as(99)
    User.objects.filter(kakao_id=99).update(is_staff=True)
    res = staff.get(f"/api/admin/notes/{note_id}/photos/{photo_id}")
    assert res.status_code == 200
    assert res.content == WEBP


def test_photo_of_closed_note_is_hidden():
    owner = login_as(1)
    note_id = create_note(owner)
    photo_id = upload(owner, note_id).json()["id"]
    Note.objects.filter(pk=note_id).update(closed_at=clock.now(), closed_reason="신고")
    assert owner.get(f"/api/notes/{note_id}/photos/{photo_id}").status_code == 403


def test_region_is_taken_from_the_endpoint_when_unset():
    assert photos.region_from_endpoint("https://ns.compat.objectstorage.us-example-1.oraclecloud.com") == "us-example-1"
    assert photos.region_from_endpoint("") == "us-east-1"
