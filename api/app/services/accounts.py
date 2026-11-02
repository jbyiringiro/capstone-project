"""Adult accounts (FR1): registration and password login."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..security import hash_password, verify_password
from .errors import Conflict, InvalidCredentials


class AccountService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _by_phone(self, phone: str) -> models.User | None:
        return self.db.scalar(select(models.User).where(models.User.phone == phone))

    def register(self, body: schemas.UserCreate) -> models.User:
        if self._by_phone(body.phone):
            raise Conflict("phone already registered")
        user = models.User(name=body.name, phone=body.phone, role=body.role,
                           password_hash=hash_password(body.password))
        self.db.add(user)
        try:
            self.db.commit()
        except IntegrityError:
            # Two registrations raced past the lookup above.
            self.db.rollback()
            raise Conflict("phone already registered")
        self.db.refresh(user)
        return user

    def authenticate(self, phone: str, password: str) -> models.User:
        user = self._by_phone(phone)
        if not user or not verify_password(password, user.password_hash):
            raise InvalidCredentials("wrong phone or password")
        return user
