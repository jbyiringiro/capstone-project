"""Adult accounts (FR1): a mobile number confirmed by SMS and one PIN, which signs in here and opens
the caregiver area on each device. A forgotten PIN is replaced with a new code texted to the number,
and five wrong PINs lock the number for a while."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
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
        user.password_hash = hash_password(body.pin)
        # Holding the number is proof enough to lift a lock left by wrong PINs.
        attempts = self.db.get(models.LoginAttempt, body.phone)
        if attempts:
            attempts.failures, attempts.locked_until = 0, None
        self.db.commit()

    def change_pin(self, body: schemas.PinChange) -> None:
        user = self.authenticate(body.phone, body.pin)
        user.password_hash = hash_password(body.new_pin)
        self.db.commit()

    def authenticate(self, phone: str, pin: str) -> models.User:
        try:
            phone = schemas.normalise_phone(phone)
        except ValueError:
            raise InvalidCredentials("wrong phone or PIN") from None
        user = self._by_phone(phone)
        if user is None:
            raise InvalidCredentials("wrong phone or PIN")
        now = codes._now()
        attempts = self.db.get(models.LoginAttempt, phone)
        if attempts and attempts.locked_until and now < attempts.locked_until:
            raise TooManyTries("too many wrong PINs", codes._seconds(attempts.locked_until - now))
        if verify_password(pin, user.password_hash):
            if attempts and (attempts.failures or attempts.locked_until):
                attempts.failures, attempts.locked_until = 0, None
                self.db.commit()
            return user
        if attempts is None:
            attempts = models.LoginAttempt(phone=phone, failures=0)
            self.db.add(attempts)
        attempts.failures += 1
        locked = attempts.failures >= MAX_TRIES
        if locked:
            attempts.failures, attempts.locked_until = 0, now + LOCK_FOR
        try:
            self.db.commit()
        except IntegrityError:
            # Another wrong PIN for this number was counted at the same moment.
            self.db.rollback()
        if locked:
            raise TooManyTries("too many wrong PINs", codes._seconds(LOCK_FOR))
        raise InvalidCredentials("wrong phone or PIN")
