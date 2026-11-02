"""Pseudonymous child profiles and their enabled vocabulary (FR2).

Every lookup is scoped to the requesting adult: another account's profile behaves as missing.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from .catalogue import SymbolCatalogue
from .errors import Conflict, InvalidInput


class ProfileService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def owned(self, profile_id: str, user: models.User) -> models.ChildProfile | None:
        profile = self.db.get(models.ChildProfile, profile_id)
        return profile if profile is not None and profile.created_by == user.user_id else None

    def list_for(self, user: models.User) -> list[models.ChildProfile]:
        return list(self.db.scalars(select(models.ChildProfile).where(
            models.ChildProfile.created_by == user.user_id)))

    def create(self, user: models.User, body: schemas.ProfileCreate) -> models.ChildProfile:
        if self.db.scalar(select(models.ChildProfile).where(models.ChildProfile.code == body.code)):
            raise Conflict("code already used")
        profile = models.ChildProfile(code=body.code, age_band=body.age_band,
                                      access_method=body.access_method, created_by=user.user_id)
        self.db.add(profile)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise Conflict("code already used")
        self.db.refresh(profile)
        return profile

    def vocabulary(self, profile: models.ChildProfile) -> list[models.Symbol]:
        return [entry.symbol for entry in profile.vocabulary]

    def replace_vocabulary(self, profile: models.ChildProfile, symbol_ids: list[int]) -> int:
        """Swap the enabled set; unknown IDs reject the whole request before any row changes."""
        requested = set(symbol_ids)
        if SymbolCatalogue(self.db).known_ids(requested) != requested:
            raise InvalidInput("unknown symbol IDs")
        current = {entry.symbol_id for entry in profile.vocabulary}
        for entry in list(profile.vocabulary):
            if entry.symbol_id not in requested:
                self.db.delete(entry)
        for symbol_id in requested - current:
            self.db.add(models.ProfileVocabulary(profile_id=profile.profile_id,
                                                 symbol_id=symbol_id))
        self.db.commit()
        return len(symbol_ids)
