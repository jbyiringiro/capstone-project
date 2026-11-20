"""Pseudonymous child profiles and their enabled vocabulary (FR2).

Every lookup is scoped to the requesting adult: another account's profile behaves as missing.
"""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from .backups import BackupService
from .catalogue import SymbolCatalogue
from .errors import Conflict, InvalidInput


def erase_profiles(db: Session, profile_ids: list[str]) -> None:
    """Deletes children and all the server keeps for them: synced messages and their taps, boards,
    word lists and devices. The caller commits, so the erasure is one transaction with whatever
    goes with it."""
    messages = select(models.Message.message_id).where(models.Message.profile_id.in_(profile_ids))
    boards = select(models.Board.board_id).where(models.Board.profile_id.in_(profile_ids))
    for rows in (delete(models.TapEvent).where(models.TapEvent.message_id.in_(messages)),
                 delete(models.Message).where(models.Message.profile_id.in_(profile_ids)),
                 delete(models.BoardCell).where(models.BoardCell.board_id.in_(boards)),
                 delete(models.Board).where(models.Board.profile_id.in_(profile_ids)),
                 delete(models.ProfileVocabulary).where(models.ProfileVocabulary.profile_id.in_(profile_ids)),
                 delete(models.Device).where(models.Device.profile_id.in_(profile_ids)),
                 delete(models.ChildProfile).where(models.ChildProfile.profile_id.in_(profile_ids))):
        db.execute(rows.execution_options(synchronize_session=False))


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

    def update(self, profile: models.ChildProfile, body: schemas.ProfileUpdate) -> models.ChildProfile:
        """A new code or age band for the same child; codes stay unique across accounts."""
        changes = body.model_dump(exclude_unset=True)
        code = changes.get("code", profile.code)
        if code != profile.code and self.db.scalar(select(models.ChildProfile.profile_id).where(
                models.ChildProfile.code == code)):
            raise Conflict("code already used")
        for field, value in changes.items():
            setattr(profile, field, value)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise Conflict("code already used")
        self.db.refresh(profile)
        return profile

    def delete(self, profile: models.ChildProfile) -> None:
        """Erases the child with all the server keeps for them, and records the deletion so the
        account copy leaves the child out from now on."""
        owner, profile_id = profile.created_by, profile.profile_id
        # Lock the account before touching child rows, and publish the tombstone and revision
        # atomically with the erasure. Other devices discover it through /backup/status.
        BackupService(self.db, self.db.get(models.User, owner)).remember_deletions([profile_id])
        erase_profiles(self.db, [profile_id])
        self.db.commit()

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
