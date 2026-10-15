import secrets

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models


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
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Note({self.id})"


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
