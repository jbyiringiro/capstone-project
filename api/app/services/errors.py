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
    """A wrong, used or expired SMS code (400)."""


class RetryLater(ServiceError):
    """A request refused for now (429); `retry_after` is in seconds."""

    def __init__(self, detail: str, retry_after: int) -> None:
        super().__init__(detail)
        self.retry_after = retry_after


class TooManyCodes(RetryLater):
    """Another SMS code asked for too soon (429)."""


class TooManyTries(RetryLater):
    """Five wrong PINs for a number: it is locked for a while (429)."""


class SmsFailed(ServiceError):
    """The SMS service did not take the message (502)."""
