"""Narrow server-only Neon management client for deleting a verified account.

The API key is never sent to a browser or to an auth URL. Its only destination is the
fixed Neon console API, and the configured branch must describe this app's exact auth
base URL before any deletion. The caller supplies an already verified provider UID.
"""
from __future__ import annotations

import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .errors import EmailAuthUnavailable, EmailProviderError

_API = "https://console.neon.tech/api/v2"
_ID = re.compile(r"[a-z0-9-]{1,60}\Z")
_UID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_MAX_RESPONSE = 64 * 1024


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # A management credential must never follow a redirect.


class NeonManagementDeletion:
    def __init__(self, auth_url: str, project_id: str | None, branch_id: str | None,
                 api_key: str | None):
        self.auth_url = auth_url
        self.project_id = project_id or ""
        self.branch_id = branch_id or ""
        self._api_key = api_key or ""
        self._opener = build_opener(_NoRedirects())

    @property
    def configured(self) -> bool:
        return bool(_ID.fullmatch(self.project_id) and _ID.fullmatch(self.branch_id)
                    and self.branch_id.startswith("br-") and 1 <= len(self._api_key) <= 4096
                    and all(33 <= ord(character) <= 126 for character in self._api_key))

    def require_configuration(self) -> None:
        if not self.configured:
            raise EmailProviderError("Account deletion is not configured; no account data was deleted",
                                     "ACCOUNT_DELETION_DISABLED", 503)

    def _request(self, method: str, suffix: str = "") -> dict | None:
        self.require_configuration()
        path = (f"/projects/{quote(self.project_id, safe='')}/branches/"
                f"{quote(self.branch_id, safe='')}/auth{suffix}")
        request = Request(_API + path, method=method,
                          headers={"Accept": "application/json", "Authorization": "Bearer " + self._api_key})
        try:
            with self._opener.open(request, timeout=10) as response:
                if method == "DELETE":
                    # A 404 can mean a wrong resource/configuration, not completed deletion.
                    # Only the documented 204 confirms the operation. Never interpret a
                    # revoked session, JSON success field, or other status as confirmation.
                    if response.status != 204:
                        raise ValueError("unconfirmed deletion")
                    return None
                if response.status != 200:
                    raise ValueError("unconfirmed configuration")
                raw = response.read(_MAX_RESPONSE + 1)
                if len(raw) > _MAX_RESPONSE:
                    raise ValueError("oversized response")
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise TypeError("invalid response")
                return result
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, TypeError):
            # Do not expose bodies, paths, identifiers, authorization headers or raw errors.
            raise EmailAuthUnavailable("Account deletion could not be confirmed; try again later") from None

    def preflight(self) -> None:
        result = self._request("GET")
        if (result.get("auth_provider") != "better_auth" or result.get("branch_id") != self.branch_id
                or result.get("base_url") != self.auth_url):
            raise EmailAuthUnavailable("Account deletion configuration does not match this application")

    @staticmethod
    def validate_uid(uid: str) -> None:
        # Neon uses opaque UUIDs. Refuse malformed/path-like identities rather than letting
        # a server decode an encoded separator or normalize a dot segment in a DELETE path.
        if not isinstance(uid, str) or not _UID.fullmatch(uid):
            raise EmailAuthUnavailable("Account deletion identity is invalid")

    def delete(self, uid: str) -> None:
        self.validate_uid(uid)
        self.preflight()  # Also bind retries after the local account has already been erased.
        self._request("DELETE", "/users/" + quote(uid, safe=""))
