"""A caregiver's whole device kept on their account, so a new phone or tablet gets it all back.

The app writes the snapshot (children, their words, board and place settings, custom-word photos
and familiar-voice recordings) and reads it back unchanged. Each account holds one snapshot, the
latest; other accounts never see it.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from .errors import NotFound, TooLarge

FORMAT = "vuga-account-backup-v1"


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


class BackupService:
    def __init__(self, db: Session, user: models.User) -> None:
        self.db = db
        self.user = user

    def _row(self) -> models.AccountBackup | None:
        return self.db.get(models.AccountBackup, self.user.user_id)

    def status(self) -> schemas.BackupStatus:
        row = self._row()
        return schemas.BackupStatus(saved_at=_aware(row.saved_at) if row else None, size=row.size if row else 0)

    def save(self, body: schemas.BackupIn) -> schemas.BackupStatus:
        text = json.dumps(body.data, ensure_ascii=False, separators=(",", ":"))
        size = len(text.encode("utf-8"))
        if size > settings.max_backup_bytes:
            raise TooLarge("backup too large")
        row = self._row() or models.AccountBackup(user_id=self.user.user_id)
        row.data, row.size = text, size
        row.saved_at = datetime.now(UTC).replace(tzinfo=None)
        self.db.add(row)
        self.db.commit()
        return self.status()

    def load(self) -> schemas.BackupOut:
        row = self._row()
        if row is None:
            raise NotFound("no backup on this account")
        return schemas.BackupOut(format=FORMAT, saved_at=_aware(row.saved_at), data=json.loads(row.data))
