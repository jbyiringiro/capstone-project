"""Database lock shared by changes to an account and its dependent records."""
from sqlalchemy import update
from sqlalchemy.orm import Session

from .. import models
from .errors import NotFound


def lock_account(db: Session, user_id: str) -> None:
    """Acquire the account write lock before child, backup, OTP or login-attempt rows.

    Updating an unchanged value locks the row on PostgreSQL and obtains SQLite's write lock,
    including before the first backup exists. It lasts until commit/rollback and does not
    refresh the caller's ORM user: a PIN version already authenticated must remain unchanged
    for conditional PIN-change/account-erasure checks.
    """
    locked = db.execute(update(models.User).where(models.User.user_id == user_id)
                        .values(token_version=models.User.token_version)
                        .execution_options(synchronize_session=False))
    if locked.rowcount != 1:
        raise NotFound("account not found")
