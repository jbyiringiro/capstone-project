"""A caregiver's device set-up kept on their account, so a new phone or tablet gets it back.

The app writes the copy (children by code, their words, board, place, next-word and child-mode
settings) and reads it back unchanged; schemas.BackupData refuses names, photos and recordings.
Each account holds one copy, the latest, and other accounts never see it. Every save names the
revision it builds on, and a save from a device whose copy is out of date is refused, so a newer
copy saved from another device is never replaced without the caregiver choosing to.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from .errors import NotFound, StaleBackup, TooLarge

FORMAT = "vuga-account-backup-v2"
_COPY = models.AccountBackup


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


class BackupService:
    def __init__(self, db: Session, user: models.User) -> None:
        self.db = db
        self.user = user

    def _row(self) -> models.AccountBackup | None:
        return self.db.get(_COPY, self.user.user_id, populate_existing=True)

    def status(self) -> schemas.BackupStatus:
        row = self._row()
        if row is None:
            return schemas.BackupStatus(saved_at=None)
        return schemas.BackupStatus(saved_at=_aware(row.saved_at), size=row.size, revision=row.revision)

    def save(self, body: schemas.BackupIn) -> schemas.BackupStatus:
        text = json.dumps(body.data.model_dump(mode="json", exclude_unset=True), ensure_ascii=False,
                          separators=(",", ":"))
        size = len(text.encode("utf-8"))
        if size > settings.max_backup_bytes:
            raise TooLarge("backup too large")
        now = datetime.now(UTC).replace(tzinfo=None)
        if body.base_revision == 0:
            # The account's first copy. If another device saved one first, the key is taken.
            self.db.add(_COPY(user_id=self.user.user_id, data=text, size=size, saved_at=now, revision=1))
            try:
                self.db.commit()
            except IntegrityError:
                self.db.rollback()
                raise self._stale() from None
        else:
            # Replaced only while it is still the revision this device last saved or received.
            replaced = self.db.execute(
                update(_COPY).where(_COPY.user_id == self.user.user_id, _COPY.revision == body.base_revision)
                .values(data=text, size=size, saved_at=now, revision=_COPY.revision + 1)
                .execution_options(synchronize_session=False))
            if replaced.rowcount != 1:
                self.db.rollback()
                raise self._stale()
            self.db.commit()
        return self.status()

    def _stale(self) -> StaleBackup:
        current = self.status()
        return StaleBackup("the account copy changed on another device", current.revision, current.saved_at)

    def load(self) -> schemas.BackupOut:
        row = self._row()
        if row is None:
            raise NotFound("no backup on this account")
        return schemas.BackupOut(format=FORMAT, saved_at=_aware(row.saved_at), revision=row.revision,
                                 data=json.loads(row.data))
