"""SMS codes that prove a caregiver holds a mobile number (FR1): one before an account is opened,
one before a forgotten password is replaced."""
from __future__ import annotations

import hmac
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from math import ceil

from sqlalchemy import case, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from .errors import InvalidCode, SmsFailed, TooManyCodes
from .sms import SmsSender

CODE_DIGITS = 6
CODE_LIFETIME = timedelta(minutes=10)
RESEND_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 5  # wrong tries before a code stops working
MAX_SENDS = 5  # codes one number gets for one purpose in an hour
SEND_WINDOW = timedelta(hours=1)

_CODE = models.PhoneCode
_STATE = ("code_hash", "expires_at", "attempts", "sent_at", "sends", "window_start")

# Plain characters only, so each text fits one 160-character SMS.
MESSAGES = {
    "register": "Vuga: kode yo kwemeza nimero yawe ni {code}. Imara iminota 10. Ntuyihe undi muntu.",
    "reset": "Vuga: kode yo guhindura ijambobanga ni {code}. Imara iminota 10. Ntuyihe undi muntu.",
}


def _now() -> datetime:
    """UTC without a time zone, as the DateTime columns store it."""
    return datetime.now(UTC).replace(tzinfo=None)


def _digest(phone: str, purpose: str, code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"{phone}:{purpose}:{code}".encode(),
                    sha256).hexdigest()


def _seconds(delta: timedelta) -> int:
    return max(1, ceil(delta.total_seconds()))


class PhoneCodes:
    def __init__(self, db: Session, sms: SmsSender | None = None) -> None:
        self.db = db
        self.sms = sms

    def send(self, phone: str, purpose: str) -> None:
        """Reserve a send before calling the provider, then activate only its accepted code.

        The reservation is committed, so another process sees the cooldown even while the
        provider is slow. A definite refusal restores the previous state only if this request
        still owns the reservation. Unknown outcomes (transport errors, interrupted workers,
        or a database failure after delivery) leave the reservation unusable and counting
        towards the hourly budget; the caregiver can request a fresh code after the cooldown.
        A late response cannot replace a newer code. Provider acceptance alone still does
        not prove handset delivery.
        """
        before, reserved = self._reserve(phone, purpose)
        code = f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"
        try:
            self.sms.send(phone, MESSAGES[purpose].format(code=code))
        except SmsFailed as failure:
            # Definite refusal is retryable immediately. An unknown delivery outcome or
            # unexpected exception leaves the reservation: it may already have sent a text.
            if not failure.delivery_uncertain:
                self._restore(phone, purpose, before, reserved)
            raise
        activated = self.db.execute(
            update(_CODE).where(*self._matches(phone, purpose, reserved), _CODE.expires_at > _now())
            .values(code_hash=_digest(phone, purpose, code))
            .execution_options(synchronize_session=False))
        self.db.commit()
        if activated.rowcount != 1:
            current = self._state(phone, purpose)
            wait = _seconds(current["sent_at"] + RESEND_AFTER - _now()) if current else 1
            raise TooManyCodes("this code request was replaced or expired; ask for another code", wait)

    def _state(self, phone: str, purpose: str) -> dict | None:
        # Select scalar columns: an ORM object cached by this session may predate another
        # request's commit. Every compare-and-swap starts with a fresh database snapshot.
        row = self.db.execute(select(*(getattr(_CODE, key) for key in _STATE)).where(
            _CODE.phone == phone, _CODE.purpose == purpose)).mappings().one_or_none()
        return dict(row) if row is not None else None

    @staticmethod
    def _matches(phone: str, purpose: str, state: dict):
        return (_CODE.phone == phone, _CODE.purpose == purpose,
                *(getattr(_CODE, key) == state[key] for key in _STATE))

    def _reserve(self, phone: str, purpose: str) -> tuple[dict | None, dict]:
        """An insert or conditional update wins the right to send across server workers."""
        for _ in range(8):
            now, before = _now(), self._state(phone, purpose)
            if before and now < before["sent_at"] + RESEND_AFTER:
                raise TooManyCodes("wait before asking for another code",
                                   _seconds(before["sent_at"] + RESEND_AFTER - now))
            same_window = before is not None and now < before["window_start"] + SEND_WINDOW
            if same_window and before["sends"] >= MAX_SENDS:
                raise TooManyCodes("too many codes for this number",
                                   _seconds(before["window_start"] + SEND_WINDOW - now), "limit")
            reserved = {"code_hash": None, "expires_at": now + CODE_LIFETIME,
                        "attempts": 0, "sent_at": now,
                        "sends": before["sends"] + 1 if same_window else 1,
                        "window_start": before["window_start"] if same_window else now}
            if before is None:
                self.db.add(_CODE(phone=phone, purpose=purpose, **reserved))
                try:
                    self.db.commit()
                    return before, reserved
                except IntegrityError:
                    # Another worker inserted first. Re-read its committed reservation;
                    # no provider call has happened in this losing request.
                    self.db.rollback()
                    continue
            changed = self.db.execute(
                update(_CODE).where(*self._matches(phone, purpose, before)).values(**reserved)
                .execution_options(synchronize_session=False))
            if changed.rowcount == 1:
                self.db.commit()
                return before, reserved
            # Consumption, a failed attempt or another send changed the row meanwhile.
            self.db.rollback()
        raise TooManyCodes("another code request is in progress", 1)

    def _restore(self, phone: str, purpose: str, before: dict | None, reserved: dict) -> None:
        statement = (delete(_CODE) if before is None else update(_CODE).values(**before))
        self.db.execute(statement.where(*self._matches(phone, purpose, reserved))
                        .execution_options(synchronize_session=False))
        self.db.commit()

    def use(self, phone: str, purpose: str, code: str) -> None:
        """Accepts the code once. The caller commits, with the change the code allows."""
        digest = _digest(phone, purpose, code)
        live = (_CODE.phone == phone, _CODE.purpose == purpose, _CODE.code_hash.is_not(None),
                _CODE.expires_at > _now(), _CODE.attempts < MAX_ATTEMPTS)
        # The database compares keyed digests, not the six-digit plaintext. The predicate
        # and mutation are one statement: a stale session cannot consume a spent code.
        consumed = self.db.execute(update(_CODE).where(*live, _CODE.code_hash == digest)
                                   .values(code_hash=None)
                                   .execution_options(synchronize_session=False))
        if consumed.rowcount == 1:
            return  # keep consumption in the registration/reset transaction
        attempt = self.db.execute(
            update(_CODE).where(*live, _CODE.code_hash != digest)
            .values(attempts=_CODE.attempts + 1,
                    code_hash=case((_CODE.attempts >= MAX_ATTEMPTS - 1, None), else_=_CODE.code_hash))
            .returning(_CODE.attempts).execution_options(synchronize_session=False)).scalar_one_or_none()
        if attempt is not None:
            self.db.commit()
            if attempt >= MAX_ATTEMPTS:
                raise InvalidCode("too many wrong tries of this code", "spent")
            raise InvalidCode("wrong code", "wrong", MAX_ATTEMPTS - attempt)
        self.db.rollback()
        row = self._state(phone, purpose)
        if row is not None and row["code_hash"] is None and row["attempts"] >= MAX_ATTEMPTS:
            raise InvalidCode("too many wrong tries of this code", "spent")
        raise InvalidCode("expired or used code", "expired")
