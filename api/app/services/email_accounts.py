"""Verified Firebase identities mapped to Vuga accounts and durable deletion tombstones."""
from datetime import UTC, datetime

from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from .errors import (
    Conflict,
    EmailAuthUnavailable,
    EmailDeletionPending,
    InvalidCredentials,
    InvalidInput,
)
from .firebase_auth import EmailIdentity, FirebaseAuth, firebase_auth
from .locking import lock_account
from .profiles import erase_profiles


class EmailAccountService:
    def __init__(self, db: Session, provider: FirebaseAuth | None = None) -> None:
        self.db = db
        self.provider = provider or firebase_auth

    def _user(self, identity: EmailIdentity) -> models.User | None:
        return self.db.scalar(select(models.User).where(
            models.User.firebase_project_id == identity.project_id, models.User.firebase_uid == identity.uid))

    def _identity(self, identity: EmailIdentity) -> models.FirebaseIdentity | None:
        return self.db.get(models.FirebaseIdentity, (identity.project_id, identity.uid), populate_existing=True)

    def _lock_identity(self, identity: EmailIdentity) -> models.FirebaseIdentity:
        table = models.FirebaseIdentity
        if self._identity(identity) is None:
            try:
                self.db.execute(insert(table).values(project_id=identity.project_id, uid=identity.uid,
                                                      deleted=False))
                self.db.commit()
            except IntegrityError:
                self.db.rollback()  # A concurrent first sign-in created the same lock row.
        self.db.execute(update(table).where(table.project_id == identity.project_id, table.uid == identity.uid)
                        .values(deleted=table.deleted).execution_options(synchronize_session=False))
        return self._identity(identity)

    def session(self, body: schemas.EmailSessionIn) -> models.User:
        identity = self.provider.verify(body.id_token)
        record = self._lock_identity(identity)
        if record.deleted:
            self.db.rollback()
            raise InvalidCredentials("this email account was deleted")
        try:
            user = self._user(identity)
            if user is None:
                if body.name is None:
                    self.db.rollback()
                    raise InvalidInput("name is required when creating an email account")
                user = models.User(name=body.name, phone=None, email=identity.email, firebase_uid=identity.uid,
                                   firebase_project_id=identity.project_id, role="caregiver", password_hash=None)
                self.db.add(user)
                self.db.flush()
                record.user_id = user.user_id
            else:
                # Identity comes exclusively from the verified provider. Never merge by email.
                user.email = identity.email
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise Conflict("email is already linked to a different account") from None
        self.db.refresh(user)
        return user

    def authenticate(self, token: str) -> models.User:
        identity = self.provider.verify(token)
        record = self._identity(identity)
        user = self._user(identity)
        if record is None or record.deleted or user is None or record.user_id != user.user_id:
            raise InvalidCredentials("invalid or expired email session")
        return user

    def delete_account(self, body: schemas.EmailDelete) -> None:
        # Signatures are checked even for retries. A tombstone permits only cleanup of the exact
        # previously erased account, never new sign-in/access or an arbitrary provider identity.
        identity = self.provider.verify_signature(body.id_token, recent=True)
        record = self._identity(identity)
        if record is None or record.user_id != body.user_id:
            raise InvalidCredentials("email session does not match this account")
        if not record.deleted:
            self.provider.verify(body.id_token, recent=True)
            record = self._lock_identity(identity)
            if record.user_id != body.user_id:
                raise InvalidCredentials("email session does not match this account")
            if not record.deleted:
                user = self._user(identity)
                if user is None or user.user_id != body.user_id:
                    raise InvalidCredentials("email session does not match this account")
                # Match backup/profile lock order before deleting dependent rows. The identity
                # lock also excludes a concurrent session() from recreating this account.
                lock_account(self.db, user.user_id)
                erase_profiles(self.db, list(self.db.scalars(select(models.ChildProfile.profile_id).where(
                    models.ChildProfile.created_by == user.user_id))))
                for statement in (
                    delete(models.DeletedProfile).where(models.DeletedProfile.user_id == user.user_id),
                    delete(models.AccountBackup).where(models.AccountBackup.user_id == user.user_id),
                    delete(models.User).where(models.User.user_id == user.user_id),
                ):
                    self.db.execute(statement.execution_options(synchronize_session=False))
                record.deleted, record.deleted_at = True, datetime.now(UTC).replace(tzinfo=None)
                self.db.commit()
        # Commit local erasure first. If Firebase fails, no old token or delayed session exchange
        # can resurrect it. Retrying this endpoint is safe with the same recent signed ID token.
        try:
            self.provider.delete(body.id_token)
        except (EmailAuthUnavailable, InvalidCredentials):
            raise EmailDeletionPending(
                "Vuga account data was deleted; retry to finish deleting the email account") from None
