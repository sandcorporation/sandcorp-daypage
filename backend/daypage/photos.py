"""사진: 지면에 붙인 사진의 원본을 오브젝트 저장소(Oracle Object Storage, S3 호환 API)에 둔다.

브라우저가 사진을 작게 줄여(frontend/src/page/photos.ts) 올리고, 장 문서의 photos 맵에는 사진 id(src)와 자리만 남는다.
서버 비용 때문에 한 장에 보이는 사진은 PHOTO_LIMIT장, 한 장당 PHOTO_MAX_BYTES까지. 지웠다 다시 붙이는 것을 감안해
한 장에 올릴 수 있는 횟수는 UPLOADS_PER_PAGE로 따로 묶는다. 봉인할 때 문서에 남은(보이는) 사진만 두고 나머지는 지운다.
"""

import logging
import secrets
from typing import Protocol

from django.conf import settings
from django.db import transaction
from pycrdt import Doc, Map

logger = logging.getLogger(__name__)

PHOTO_LIMIT = 3
PHOTO_MAX_BYTES = 150_000
UPLOADS_PER_PAGE = 12

# 받는 형식: 바이트 머리로 확인한다(브라우저가 붙인 Content-Type은 믿지 않는다)
_MAGIC = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
)


def sniff_mime(data: bytes) -> str | None:
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    for magic, mime in _MAGIC:
        if data.startswith(magic):
            return mime
    return None


def new_id() -> str:
    return secrets.token_hex(16)


def object_key(note_id: str, photo_id: str) -> str:
    return f"notes/{note_id}/{photo_id}"


class Store(Protocol):
    def put(self, key: str, data: bytes, mime: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, keys: list[str]) -> None: ...


class S3Store:
    """Oracle Object Storage의 S3 호환 API. 경로 방식 주소(bucket이 경로에)여야 한다."""

    def __init__(self) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = settings.PHOTO_S3_BUCKET
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.PHOTO_S3_ENDPOINT,
            region_name=settings.PHOTO_S3_REGION,
            aws_access_key_id=settings.PHOTO_S3_ACCESS_KEY,
            aws_secret_access_key=settings.PHOTO_S3_SECRET_KEY,
            config=Config(
                s3={"addressing_style": "path"},
                # OCI는 새 체크섬 머리(x-amz-checksum-*)를 받지 않는다
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                connect_timeout=5,
                read_timeout=10,
                retries={"max_attempts": 2},
            ),
        )

    def put(self, key: str, data: bytes, mime: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=mime)

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, keys: list[str]) -> None:
        for i in range(0, len(keys), 1000):
            chunk = keys[i : i + 1000]
            self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True})


class MemoryStore:
    """테스트용"""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def put(self, key: str, data: bytes, mime: str) -> None:
        self.objects[key] = (data, mime)

    def get(self, key: str) -> bytes:
        return self.objects[key][0]

    def delete(self, keys: list[str]) -> None:
        for k in keys:
            self.objects.pop(k, None)


_store: Store | None = None


def configured() -> bool:
    return all(
        (settings.PHOTO_S3_ENDPOINT, settings.PHOTO_S3_BUCKET, settings.PHOTO_S3_ACCESS_KEY, settings.PHOTO_S3_SECRET_KEY)
    )


def store() -> Store | None:
    """설정된 저장소. 설정이 없으면 None(사진을 쓸 수 없다)."""
    global _store
    if _store is None and configured():
        _store = S3Store()
    return _store


def set_store(s: Store | None) -> None:
    global _store
    _store = s


def delete_later(keys: list[str]) -> None:
    """DB 변경이 저장된 뒤 저장소에서 지운다. 실패해도 남는 것은 고아 파일뿐이라 기록만 남긴다."""
    if not keys:
        return

    def run() -> None:
        s = store()
        if s is None:
            return
        try:
            s.delete(keys)
        except Exception:
            logger.exception("사진 %d개를 저장소에서 지우지 못했어요", len(keys))

    transaction.on_commit(run)


def visible_photo_ids(doc: Doc) -> list[tuple[str, str]]:
    """문서에서 보이는 사진들(맵 key, src): 넣은 순으로 PHOTO_LIMIT장까지(프론트 readPhotos와 같은 규칙)."""
    photos = doc.get("photos", type=Map)
    items = []
    for key, m in list(photos.items()):
        if not isinstance(m, Map) or not isinstance(m.get("src"), str):
            continue
        created = m.get("createdAt")
        items.append((created if isinstance(created, (int, float)) else 0, key, m.get("src")))
    items.sort(key=lambda t: (t[0], t[1]))
    return [(key, src) for _, key, src in items[:PHOTO_LIMIT]]


def settle_sealed_photos(doc: Doc, page) -> bool:
    """봉인할 때: 한도를 넘었거나 이 노트에 없는 사진은 문서에서 빼고, 문서에 남지 않은 원본은 지운다.
    문서를 바꿨으면 True."""
    from .models import Photo

    photos = doc.get("photos", type=Map)
    known = set(Photo.objects.filter(note_id=page.note_id).values_list("id", flat=True))
    keep = {key: src for key, src in visible_photo_ids(doc) if src in known}
    drop = [key for key in list(photos.keys()) if key not in keep]
    if drop:
        with doc.transaction():
            for key in drop:
                del photos[key]
    kept_src = set(keep.values())
    gone = list(Photo.objects.filter(page=page).exclude(id__in=kept_src).values_list("id", flat=True))
    if gone:
        Photo.objects.filter(id__in=gone).delete()
        delete_later([object_key(page.note_id, pid) for pid in gone])
    return bool(drop)
