"""Business-rule violations raised by the services.

Services stay free of HTTP concerns; `app.main` maps each subclass to a status code in one place.
"""
from __future__ import annotations


class ServiceError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class InvalidCredentials(ServiceError):
    """Unknown phone or wrong password (401)."""


class NotOwned(ServiceError):
    """The record exists but belongs to another account (403)."""


class NotFound(ServiceError):
    """Missing, or hidden from the requesting account (404)."""


class Conflict(ServiceError):
    """An identifier is already taken (409)."""


class InvalidInput(ServiceError):
    """Well-formed request that references unknown data (422)."""


class TooLarge(ServiceError):
    """An upload over its size limit (413)."""
