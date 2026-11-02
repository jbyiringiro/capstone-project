"""Adult accounts (FR1): a mobile number confirmed by SMS and one PIN, which signs in here and opens
the caregiver area on each device. A forgotten PIN is replaced with a new code texted to the number,
five wrong PINs lock the number for a while, and a new PIN ends every session opened with the old."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..security import hash_password, verify_password
from . import codes
from .codes import CODE_LIFETIME, RESEND_AFTER, PhoneCodes
from .errors import Conflict, InvalidCredentials, NotFound, TooManyTries
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
                                expires_in=int(CODE_LIFETIME.total_seconds()))

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
        self.codes.use(body.phone, "reset", body.code)
        self._new_pin(user, body.pin)
        # Holding the number is proof enough to lift a lock left by wrong PINs.
        self._clear_tries(body.phone)
        self.db.commit()

    def change_pin(self, body: schemas.PinChange) -> None:
        user = self.authenticate(body.phone, body.pin)
        self._new_pin(user, body.new_pin)
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
        digest, now = user.password_hash, codes._now()
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
