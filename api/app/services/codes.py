"""SMS codes that prove a caregiver holds a mobile number (FR1): one before an account is opened,
one before a forgotten password is replaced."""
from __future__ import annotations

import hmac
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from math import ceil

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from .errors import InvalidCode, TooManyCodes
from .sms import SmsSender

CODE_DIGITS = 6
CODE_LIFETIME = timedelta(minutes=10)
RESEND_AFTER = timedelta(seconds=60)
MAX_ATTEMPTS = 5  # wrong tries before a code stops working
MAX_SENDS = 5  # codes one number gets for one purpose in an hour
SEND_WINDOW = timedelta(hours=1)

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
        """Texts a new code, which replaces the number's last one for this purpose."""
        now = _now()
        row = self.db.get(models.PhoneCode, (phone, purpose))
        if row and now < row.sent_at + RESEND_AFTER:
            raise TooManyCodes("wait before asking for another code",
                               _seconds(row.sent_at + RESEND_AFTER - now))
        if row and now < row.window_start + SEND_WINDOW and row.sends >= MAX_SENDS:
            raise TooManyCodes("too many codes for this number",
                               _seconds(row.window_start + SEND_WINDOW - now))
        code = f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"
        # Sent before it is stored: a text that fails leaves no code and no wait behind.
        self.sms.send(phone, MESSAGES[purpose].format(code=code))
        if row is None:
            row = models.PhoneCode(phone=phone, purpose=purpose, sends=0, window_start=now)
            self.db.add(row)
        elif now >= row.window_start + SEND_WINDOW:
            row.sends, row.window_start = 0, now
        row.code_hash, row.expires_at = _digest(phone, purpose, code), now + CODE_LIFETIME
        row.attempts, row.sent_at, row.sends = 0, now, row.sends + 1
        try:
            self.db.commit()
        except IntegrityError:
            # Another request texted this number at the same moment; its code is the one kept.
            self.db.rollback()
            raise TooManyCodes("wait before asking for another code",
                               _seconds(RESEND_AFTER)) from None

    def use(self, phone: str, purpose: str, code: str) -> None:
        """Accepts the code once. The caller commits, with the change the code allows."""
        row = self.db.get(models.PhoneCode, (phone, purpose))
        if row is None or row.code_hash is None or _now() >= row.expires_at:
            raise InvalidCode("wrong or expired code")
        if not hmac.compare_digest(row.code_hash, _digest(phone, purpose, code)):
            row.attempts += 1
            if row.attempts >= MAX_ATTEMPTS:
                row.code_hash = None
            self.db.commit()
            raise InvalidCode("wrong or expired code")
        row.code_hash = None
