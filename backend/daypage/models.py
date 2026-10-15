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
