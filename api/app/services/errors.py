"""Business-rule violations raised by the services.

Services stay free of HTTP concerns; `app.main` maps each subclass to a status code in one place.
"""
from __future__ import annotations

from datetime import datetime


class ServiceError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class InvalidCredentials(ServiceError):
    """Unknown phone or wrong PIN (401)."""


class EmailAuthUnavailable(ServiceError):
    """Email sign-in is unconfigured or its provider cannot currently be reached (503)."""


class EmailNotVerified(ServiceError):
    """The email must be verified with the identity provider before cloud access (403)."""


class EmailDeletionPending(EmailAuthUnavailable):
    """Vuga data is erased; Firebase identity cleanup still needs a retry (503)."""


class NotOwned(ServiceError):
    """The record exists but belongs to another account (403)."""


class NotFound(ServiceError):
    """Missing, or hidden from the requesting account (404)."""


class Conflict(ServiceError):
    """An identifier is already taken (409)."""


class StaleBackup(Conflict):
    """Another device saved the account copy since this one last saved or received it (409). The
    reply carries the newer copy's `revision` and `saved_at`, so the caregiver can choose."""

    def __init__(self, detail: str, revision: int, saved_at: datetime | None) -> None:
        super().__init__(detail)
        self.revision = revision
        self.saved_at = saved_at


class InvalidInput(ServiceError):
    """Well-formed request that references unknown data (422)."""


class TooLarge(ServiceError):
    """An upload over its size limit (413)."""


class InvalidCode(ServiceError):
    """A wrong, used or expired SMS code (400). `reason` tells the caregiver what to do: `wrong`
    (type it again; `attempts_left` tries remain), `spent` (too many wrong tries) or `expired`
    (used, timed out, or never sent): both of the last two need a new code."""

    def __init__(self, detail: str, reason: str, attempts_left: int | None = None) -> None:
        super().__init__(detail)
        self.reason = reason
        self.attempts_left = attempts_left


class RetryLater(ServiceError):
    """A request refused for now (429); `retry_after` is in seconds."""

    def __init__(self, detail: str, retry_after: int) -> None:
        super().__init__(detail)
        self.retry_after = retry_after


class TooManyCodes(RetryLater):
    """Another SMS code asked for too soon (429). `reason` is `wait` for the minute between two
    codes, or `limit` when the number had its five codes for the hour."""

    def __init__(self, detail: str, retry_after: int, reason: str = "wait") -> None:
        super().__init__(detail, retry_after)
        self.reason = reason


class TooManyTries(RetryLater):
    """Five wrong PINs for a number: it is locked for a while (429)."""


class SmsFailed(ServiceError):
    """The provider refused the message, or acceptance could not be confirmed (502).

    An uncertain delivery keeps the OTP send reservation: a timeout or malformed response
    does not prove that the provider never sent the text. This flag is internal, not a code
    or credential returned to the browser.
    """

    def __init__(self, detail: str, *, delivery_uncertain: bool = False) -> None:
        super().__init__(detail)
        self.delivery_uncertain = delivery_uncertain


class SmsUnavailable(SmsFailed):
    """This server has no way to send texts: no provider key, and codes may not go to its log (503)."""
