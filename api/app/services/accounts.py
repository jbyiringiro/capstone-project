"""Adult accounts (FR1): a mobile number confirmed by SMS and one PIN, which signs in here and opens
the caregiver area on each device. A forgotten PIN is replaced with a new code texted to the number,
five wrong PINs lock the number for a while, and a new PIN ends every session opened with the old."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..security import hash_password, verify_password
from . import codes
from .codes import CODE_LIFETIME, RESEND_AFTER, PhoneCodes
from .errors import Conflict, InvalidCredentials, NotFound, TooManyTries
from .locking import lock_account
from .profiles import erase_profiles
from .sms import SmsSender

MAX_TRIES = 5
LOCK_FOR = timedelta(minutes=15)

_TRIES = models.LoginAttempt


class AccountService:
    def __init__(self, db: Session, sms: SmsSender | None = None) -> None:
        self.db = db
        self.codes = PhoneCodes(db, sms)

    def _by_phone(self, phone: str) -> models.User | None:
        return self.db.scalar(select(models.User).where(models.User.phone == phone))

    def send_code(self, phone: str, purpose: str) -> schemas.CodeSent:
        registered = self._by_phone(phone) is not None
        # The caregiver learns whether the number has an account: opening a second one is
        # refused, and a number without one gets no code for a new PIN.
        if purpose == "register" and registered:
            raise Conflict("phone already registered")
        if purpose == "reset" and not registered:
            raise NotFound("no account for this number")
        self.codes.send(phone, purpose)
        return schemas.CodeSent(resend_after=int(RESEND_AFTER.total_seconds()),
                                expires_in=int(CODE_LIFETIME.total_seconds()),
                                delivery=self.codes.sms.delivery)

    def register(self, body: schemas.UserCreate) -> models.User:
        if self._by_phone(body.phone):
            raise Conflict("phone already registered")
        self.codes.use(body.phone, "register", body.code)
        user = models.User(name=body.name, phone=body.phone, role=body.role,
                           password_hash=hash_password(body.pin))
        self.db.add(user)
        try:
            self.db.commit()
        except IntegrityError:
            # Two registrations raced past the lookup above.
            self.db.rollback()
            raise Conflict("phone already registered")
        self.db.refresh(user)
        return user

    def reset_pin(self, body: schemas.PinReset) -> None:
        user = self._by_phone(body.phone)
        if user is None:
            raise NotFound("no account for this number")
        # The same order as account erasure: User before PhoneCode. Otherwise a reset holding
        # its OTP could wait for an account deletion that is itself waiting for that OTP.
        lock_account(self.db, user.user_id)
        self.codes.use(body.phone, "reset", body.code)
        self._new_pin(user, body.pin)
        # Holding the number is proof enough to lift a lock left by wrong PINs.
        self._clear_tries(body.phone)
        self.db.commit()

    def change_pin(self, body: schemas.PinChange) -> None:
        user = self.authenticate(body.phone, body.pin)
        # Stored only while the PIN just checked is still the account's: a PIN replaced in between,
        # with a texted code or by another change, stays as it is.
        changed = self.db.execute(
            update(models.User)
            .where(models.User.user_id == user.user_id, models.User.token_version == user.token_version)
            .values(password_hash=hash_password(body.new_pin), token_version=models.User.token_version + 1)
            .execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            self.db.rollback()
            raise InvalidCredentials("wrong phone or PIN")
        self.db.commit()

    def delete_account(self, body: schemas.AccountDelete) -> None:
        """Erases the account and all it keeps on the server (the right to erasure, Law No. 058/2021,
        Article 23): its children by code with their words, boards and synced messages and taps, the
        account copy, the children it deleted, and the codes and PIN tries of its number. What the
        caregiver keeps on a device stays there. It is one transaction: a failure part way leaves
        the account as it was."""
        user = self.authenticate(body.phone, body.pin)
        # Child deletion and backups also lock User first. Do not refresh the authenticated
        # user here: the final version check must still reject a PIN reset that won the race.
        lock_account(self.db, user.user_id)
        erase_profiles(self.db, list(self.db.scalars(select(models.ChildProfile.profile_id).where(
            models.ChildProfile.created_by == user.user_id))))
        for rows in (delete(models.DeletedProfile).where(models.DeletedProfile.user_id == user.user_id),
                     delete(models.AccountBackup).where(models.AccountBackup.user_id == user.user_id),
                     delete(models.PhoneCode).where(models.PhoneCode.phone == user.phone),
                     delete(_TRIES).where(_TRIES.phone == user.phone)):
            self.db.execute(rows.execution_options(synchronize_session=False))
        # Erased only while the PIN just checked is still the account's, as for a PIN change.
        erased = self.db.execute(
            delete(models.User)
            .where(models.User.user_id == user.user_id, models.User.token_version == user.token_version)
            .execution_options(synchronize_session=False))
        if erased.rowcount != 1:
            self.db.rollback()
            raise InvalidCredentials("wrong phone or PIN")
        self.db.commit()

    def _new_pin(self, user: models.User, pin: str) -> None:
        user.password_hash = hash_password(pin)
        # Raised in the database, so two changes at once both count; older tokens stop working.
        user.token_version = models.User.token_version + 1

    def authenticate(self, phone: str, pin: str) -> models.User:
        try:
            phone = schemas.normalise_phone(phone)
        except ValueError:
            raise InvalidCredentials("wrong phone or PIN") from None
        user = self._by_phone(phone)
        if user is None:
            raise InvalidCredentials("wrong phone or PIN")
        # The PIN and its version, read together: the PIN is checked against this digest, and the
        # session must carry this version.
        digest, version, now = user.password_hash, user.token_version, codes._now()
        # Each try is counted before its PIN is checked, so tries sent at the same moment cannot
        # all be checked before any of them is counted: at most five are checked per lock.
        tries = self._count_try(phone, now)
        if tries is None:
            raise TooManyTries("too many wrong PINs", self._locked_for(phone, now))
        if tries > MAX_TRIES:
            raise TooManyTries("too many wrong PINs", self._lock(phone, now))
        if verify_password(pin, digest):
            self._clear_tries(phone)
            self.db.commit()
            # A PIN replaced while it was checked no longer signs in; its session would otherwise
            # carry the new PIN's version. No commit follows, so the token gets the version checked.
            self.db.refresh(user)
            if user.token_version != version:
                raise InvalidCredentials("wrong phone or PIN")
            return user
        if tries == MAX_TRIES:
            raise TooManyTries("too many wrong PINs", self._lock(phone, now))
        raise InvalidCredentials("wrong phone or PIN")

    def _count_try(self, phone: str, now: datetime) -> int | None:
        """The number's tries so far, this one included, raised in one statement; None while the
        number is locked."""
        count = (update(_TRIES)
                 .where(_TRIES.phone == phone, or_(_TRIES.locked_until.is_(None), _TRIES.locked_until <= now))
                 .values(failures=_TRIES.failures + 1, locked_until=None)
                 .returning(_TRIES.failures))
        tries = self.db.scalar(count)
        if tries is None and self.db.scalar(select(_TRIES.phone).where(_TRIES.phone == phone)) is None:
            # The number's first try: it has no row yet.
            try:
                self.db.execute(insert(_TRIES).values(phone=phone, failures=1))
                self.db.commit()
                return 1
            except IntegrityError:
                # Another try for this number added the row first; count this one on it.
                self.db.rollback()
                tries = self.db.scalar(count)
        self.db.commit()
        return tries

    def _lock(self, phone: str, now: datetime) -> int:
        """Locks the number, counts its tries afresh after the lock, and returns the wait in seconds."""
        self.db.execute(update(_TRIES).where(_TRIES.phone == phone).values(failures=0, locked_until=now + LOCK_FOR))
        self.db.commit()
        return codes._seconds(LOCK_FOR)

    def _locked_for(self, phone: str, now: datetime) -> int:
        until = self.db.scalar(select(_TRIES.locked_until).where(_TRIES.phone == phone))
        return codes._seconds(until - now) if until and until > now else 1

    def _clear_tries(self, phone: str) -> None:
        self.db.execute(update(_TRIES).where(_TRIES.phone == phone).values(failures=0, locked_until=None))
