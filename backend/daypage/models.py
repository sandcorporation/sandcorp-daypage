import secrets

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models
from django.db.models import Value


class UserManager(BaseUserManager):
    def get_or_create_kakao(self, kakao_id: int) -> "User":
        user, created = self.get_or_create(kakao_id=kakao_id)
        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
        return user


class User(AbstractBaseUser):
    """카카오 회원번호로만 식별하는 사용자. 프로필 정보는 보관하지 않는다."""

    kakao_id = models.BigIntegerField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # 운영자: 운영자 페이지(/admin)와 /api/admin을 쓸 수 있다. manage.py grant_staff로 켠다.
    # db_default: 배포 중 잠깐 함께 도는 옛 코드가 이 열 없이 사용자를 만들어도 되게 DB가 기본값을 채운다
    is_staff = models.BooleanField(default=False, db_default=False)
    # 운영자 정지(moderation.py): 이 시각까지, 또는 영구. 정지 중에는 노트에 들어가거나 만들 수 없다.
    suspended_until = models.DateTimeField(null=True, blank=True)
    suspension_permanent = models.BooleanField(default=False, db_default=False)
    suspension_reason = models.CharField(max_length=200, blank=True, default="", db_default="")

    USERNAME_FIELD = "kakao_id"

    objects = UserManager()

    def __str__(self) -> str:
        return f"User({self.pk})"


def new_note_id() -> str:
    return secrets.token_urlsafe(24)


class Note(models.Model):
    """공유 링크 하나에 대응하는 협업 문서."""

    DEFAULT_NAME = "이름 없는 노트"

    id = models.CharField(primary_key=True, max_length=32, default=new_note_id, editable=False)
    name = models.CharField(max_length=60, default=DEFAULT_NAME)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="owned_notes")
    # 정원: 만든 사람을 포함한 참여자 최대 인원. None이면 무제한.
    member_limit = models.PositiveSmallIntegerField(null=True, blank=True)
    # 노트 색: 참여자가 더한 잉크 색(#rrggbb, 더한 순서). 날짜와 상관없이 남는다.
    colors = models.JSONField(default=list, blank=True)
    # 노트 종이(paper.py). 빈 값이면 기본 줄 노트. db_default: 배포 중 옛 코드가 이 열 없이 노트를 만들어도 되게.
    paper = models.JSONField(default=dict, blank=True, db_default=Value({}, output_field=models.JSONField()))
    created_at = models.DateTimeField(auto_now_add=True)
    # 운영자가 닫은 노트(moderation.py). 지우지 않고, 다시 열 때까지 아무도 들어오지 못한다.
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_reason = models.CharField(max_length=200, blank=True, default="", db_default="")

    def __str__(self) -> str:
        return f"Note({self.id})"

    def is_full(self) -> bool:
        return self.member_limit is not None and self.members.count() >= self.member_limit


class NoteMember(models.Model):
    """노트에 한 번이라도 들어온 사용자. 노트 안 닉네임·색은 고정이다."""

    note = models.ForeignKey(Note, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    nickname = models.CharField(max_length=40)
    color = models.CharField(max_length=7)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_visited_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["note", "user"], name="uniq_member_note_user"),
            models.UniqueConstraint(fields=["note", "nickname"], name="uniq_member_note_nickname"),
        ]


class Page(models.Model):
    """노트의 하루치 장. 내용은 Yjs 문서 바이너리(스냅샷 + 증분)로 저장한다."""

    note = models.ForeignKey(Note, on_delete=models.CASCADE, related_name="pages")
    date = models.DateField()
    state = models.BinaryField(default=b"")
    sealed_at = models.DateTimeField(null=True, blank=True)
    stroke_count = models.PositiveIntegerField(default=0)
    participant_count = models.PositiveIntegerField(default=0)
    is_empty = models.BooleanField(default=True)
    # 봉인할 때의 노트 종이(지난 기록이 그날 종이로 보이게). 봉인 전·옛 장은 비어 있다.
    paper = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["note", "date"], name="uniq_page_note_date")]
        indexes = [models.Index(fields=["sealed_at", "date"])]


class PageUpdate(models.Model):
    """스냅샷 이후 쌓인 Yjs 증분. 주기적으로 스냅샷에 합치고 지운다."""

    page = models.ForeignKey(Page, on_delete=models.CASCADE, related_name="updates")
    update = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)


class Suggestion(models.Model):
    """기능 건의. 사용자가 노트 화면에서 남기고 운영자 페이지에서 읽는다."""

    class Status(models.TextChoices):
        NEW = "new", "새 건의"
        REVIEWING = "reviewing", "검토 중"
        DONE = "done", "반영함"
        DECLINED = "declined", "안 함"

    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="suggestions")
    # 어느 노트에서 보냈는지(노트가 지워지면 비운다)
    note = models.ForeignKey(Note, on_delete=models.SET_NULL, null=True, blank=True, related_name="suggestions")
    text = models.TextField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NEW)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["status", "created_at"])]


class NoteBan(models.Model):
    """노트를 만든 사람이 내보낸 사람. 다시 허용할 때까지 이 노트에 들어오지 못한다."""

    note = models.ForeignKey(Note, on_delete=models.CASCADE, related_name="bans")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="note_bans")
    # 내보낼 때의 노트 안 닉네임(다시 허용 목록에 보인다)
    nickname = models.CharField(max_length=40)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["note", "user"], name="uniq_ban_note_user")]


class AdminLog(models.Model):
    """운영자가 노트를 열람하거나 조치한 기록. 노트·사용자가 지워져도 남도록 id와 이름을 따로 적는다."""

    staff = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="admin_logs")
    # view_note, view_page, close_note, reopen_note, suspend_user, unsuspend_user
    action = models.CharField(max_length=32)
    note_id = models.CharField(max_length=32, blank=True, default="")
    note_name = models.CharField(max_length=60, blank=True, default="")
    target_user_id = models.IntegerField(null=True, blank=True)
    # 본 날짜, 조치 사유 등
    detail = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["-created_at"])]
