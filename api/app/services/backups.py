"""A caregiver's device set-up kept on their account, so a new phone or tablet gets it back.

The app writes the copy (children by code, their words, board, place, next-word and child-mode
settings) and reads it back unchanged; schemas.BackupData takes only those shapes, so names, free
text, photos and recordings are refused. Each account holds one copy, the latest, and other accounts
never see it. Every save names the revision it builds on and is told the revision it wrote, and a
save from a device whose copy is out of date is refused, so a newer copy saved from another device
is never replaced without the caregiver choosing to.

A child the caregiver deleted, on a device or through DELETE /profiles, is remembered by id
(models.DeletedProfile). Every save and every copy sent back leaves such children out, with their
words and settings, so a device that still had one cannot bring it back; the copy lists the ids in
`deleted`, so a device that receives it removes them too.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from .errors import NotFound, StaleBackup, TooLarge
from .locking import lock_account

FORMAT = "vuga-account-backup-v2"
_COPY = models.AccountBackup


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


def _without(data: dict, gone: set[str]) -> dict:
    """The copy without deleted children, their words and settings, or the open child if it was one."""
    if not gone:
        return data

    def kept(setting: dict) -> bool:
        key, value = setting["key"], setting.get("value")
        if ":" in key:
            return key.split(":", 1)[1] not in gone
        return not (key == "profile" and isinstance(value, dict) and value.get("profile_id") in gone)
    return {**data,
            "profiles": [p for p in data["profiles"] if p["profile_id"] not in gone],
            "vocabulary": [w for w in data["vocabulary"] if w["profile_id"] not in gone],
            "settings": [s for s in data["settings"] if kept(s)]}


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

    def _deleted(self) -> set[str]:
        return set(self.db.scalars(select(models.DeletedProfile.profile_id).where(
            models.DeletedProfile.user_id == self.user.user_id)))

    def _remember_deleted(self, ids: list[str]) -> bool:
        """Stage new tombstones under the account lock; the caller commits their revision too."""
        new = set(ids) - self._deleted()
        if not new:
            return False
        self.db.add_all(models.DeletedProfile(user_id=self.user.user_id, profile_id=profile_id)
                        for profile_id in sorted(new))
        self.db.flush()
        return True

    def _write(self, data: dict, row: models.AccountBackup | None) -> schemas.BackupStatus:
        text = json.dumps(_without(data, self._deleted()), ensure_ascii=False, separators=(",", ":"))
        size = len(text.encode("utf-8"))
        if size > settings.max_backup_bytes:
            raise TooLarge("backup too large")
        now = datetime.now(UTC).replace(tzinfo=None)
        revision = row.revision + 1 if row is not None else 1
        if row is None:
            self.db.add(_COPY(user_id=self.user.user_id, data=text, size=size, saved_at=now, revision=revision))
        else:
            row.data, row.size, row.saved_at, row.revision = text, size, now, revision
        return schemas.BackupStatus(saved_at=_aware(now), size=size, revision=revision)

    def remember_deletions(self, ids: list[str]) -> None:
        """Stage a visible deletion and its revision, in the caller's child-erasure transaction.

        With no previous copy, create an empty one carrying the deletion history. A first save
        racing this operation must then reconcile it instead of treating the account as empty.
        """
        lock_account(self.db, self.user.user_id)
        if self._remember_deleted(ids):
            row = self._row()
            data = json.loads(row.data) if row else {"profiles": [], "vocabulary": [], "settings": []}
            self._write(data, row)

    def save(self, body: schemas.BackupIn) -> schemas.BackupStatus:
        lock_account(self.db, self.user.user_id)
        row = self._row()
        revision = row.revision if row is not None else 0
        changed = self._remember_deleted(body.data.deleted or [])
        if body.base_revision != revision:
            # A stale save never replaces newer words/settings. Its deletions remain facts, but
            # must advance the visible revision in the SAME transaction or unchanged devices
            # would never fetch them. Duplicate tombstones need no extra revision.
            if changed:
                data = json.loads(row.data) if row else {"profiles": [], "vocabulary": [], "settings": []}
                status = self._write(data, row)
                self.db.commit()
                raise StaleBackup("the account copy changed on another device", status.revision, status.saved_at)
            self.db.rollback()
            raise self._stale()
        data = body.data.model_dump(mode="json", exclude_unset=True)
        data.pop("deleted", None)  # kept in deleted_profiles, and added back on load
        status = self._write(data, row)
        self.db.commit()
        # What this save wrote, not the copy as it is now: another device may already have saved on
        # it, and this device's next save must build on its own copy to be refused.
        return status

    def _stale(self) -> StaleBackup:
        current = self.status()
        return StaleBackup("the account copy changed on another device", current.revision, current.saved_at)

    def load(self) -> schemas.BackupOut:
        row = self._row()
        if row is None:
            raise NotFound("no backup on this account")
        # A child deleted through DELETE /profiles after this copy was saved is left out too.
        gone = self._deleted()
        data = _without(json.loads(row.data), gone)
        if gone:
            data["deleted"] = sorted(gone)
        return schemas.BackupOut(format=FORMAT, saved_at=_aware(row.saved_at), revision=row.revision,
                                 data=data)
